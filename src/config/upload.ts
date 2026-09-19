import multer from 'multer';
import { HttpError } from '../middlewares/errorHandler.js';

// Usamos memoryStorage para permitir streaming directo tanto a Cloudflare R2 / AWS S3 como a disco local
const storage = multer.memoryStorage();

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/jpg'];
  if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new HttpError(400, 'Solo se permiten imágenes (JPG, PNG, WEBP, HEIC, etc.)'));
  }
};

export const uploadComprobante = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB máximo
  },
  fileFilter
});
