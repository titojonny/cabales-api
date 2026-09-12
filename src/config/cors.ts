import cors, { CorsOptions } from 'cors';

const ALLOWED_ORIGINS = [
  // Angular CLI dev
  'http://localhost:4200',
  'http://127.0.0.1:4200',
  // Ionic CLI dev
  'http://localhost:8100',
  'http://127.0.0.1:8100',
  // Capacitor & Ionic WebViews (Android y iOS nativo)
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost'
];

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Permitir peticiones sin origen (apps nativas móviles, Postman, curl, scripts del servidor)
    if (!origin) {
      return callback(null, true);
    }

    // Orígenes configurados en variables de entorno (soporta lista separada por comas)
    const envOrigins = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map((url) => url.trim())
      : [];

    if (ALLOWED_ORIGINS.includes(origin) || envOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Permitir IPs de red local para pruebas con dispositivos físicos (Wi-Fi 192.168.x.x o 10.x.x.x)
    if (/^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // En desarrollo permitimos cualquier puerto localhost
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    callback(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true,
  maxAge: 86400 // 24h para preflight cache
};

export const corsMiddleware = cors(corsOptions);
