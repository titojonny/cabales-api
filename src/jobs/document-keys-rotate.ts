import { loadConfig } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { createContainer } from '../composition.js';
import { DocumentEncryption } from '../modules/documents/document-encryption.js';

/** Reenvuelve claves de datos sin tocar ciphertext; opcionalmente cifra documentos legacy. */
const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const container = createContainer(config, logger);
const encryption = new DocumentEncryption(config.documentEncryptionKeys, config.documentEncryptionActiveKeyId);
const storageOptions = config.S3_SSE
  ? {
      serverSideEncryption: config.S3_SSE,
      ...(config.S3_SSE_KMS_KEY_ID ? { kmsKeyId: config.S3_SSE_KMS_KEY_ID } : {}),
    }
  : undefined;

if (!encryption.enabled) throw new Error('DOCUMENT_ENCRYPTION_KEYS no esta configurado');

try {
  const documents = await container.db.document.findMany({
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      isLegacy: true,
      encryptionKeyId: true,
      encryptionIv: true,
      encryptionTag: true,
      wrappedDataKey: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  let rewrapped = 0;
  let legacyEncrypted = 0;
  for (const document of documents) {
    if (document.encryptionKeyId && document.wrappedDataKey) {
      if (document.encryptionKeyId !== config.documentEncryptionActiveKeyId) {
        const next = encryption.rewrap(document.wrappedDataKey, document.encryptionKeyId);
        if (next.keyId !== document.encryptionKeyId || next.wrappedDataKey !== document.wrappedDataKey) {
          await container.db.document.update({ where: { id: document.id }, data: { encryptionKeyId: next.keyId, wrappedDataKey: next.wrappedDataKey } });
          rewrapped += 1;
        }
      }
      // Un documento con sobre ya no se trata como plaintext, aunque una fila antigua tenga isLegacy=true.
      continue;
    }
    if (!document.isLegacy || !config.DOCUMENT_ENCRYPTION_MIGRATE_LEGACY) continue;
    const plaintext = await container.storage.get(document.storageKey);
    const payload = encryption.encrypt(plaintext);
    if (container.storage.replace)
      await container.storage.replace(
        document.storageKey,
        payload.ciphertext,
        document.mimeType,
        storageOptions,
      );
    else {
      await container.storage.delete(document.storageKey);
      await container.storage.put(
        document.storageKey,
        payload.ciphertext,
        document.mimeType,
        storageOptions,
      );
    }
    await container.db.document.update({
      where: { id: document.id },
      data: {
        isLegacy: false,
        encryptionKeyId: payload.keyId,
        encryptionIv: payload.iv,
        encryptionTag: payload.tag,
        wrappedDataKey: payload.wrappedDataKey,
      },
    });
    legacyEncrypted += 1;
  }
  logger.info({ rewrapped, legacyEncrypted }, 'Rotacion de claves de documentos completada');
} finally {
  await container.rateLimitStores.close();
  await container.db.$disconnect();
}
