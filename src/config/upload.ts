import multer from 'multer';
import { AppError } from '../shared/errors.js';

/** Almacena el archivo en memoria para enviarlo a disco local, S3 o R2. */
const storage = multer.memoryStorage();

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/jpg',
  ];
  if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
    cb(null, true);
    return;
  }
  cb(new AppError(400, 'INVALID_UPLOAD', 'Solo se permiten imagenes (JPG, PNG, WEBP, HEIC)'));
};

/** Middleware de subida de comprobantes: imagenes de hasta 10 MB. */
export const uploadComprobante = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter,
});
