import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://cabales_user:cabales_secret@localhost:5434/cabales_db?schema=public';

export const pool = new pg.Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

// Cierre ordenado de conexiones (graceful shutdown)
const gracefulShutdown = async () => {
  try {
    await prisma.$disconnect();
    await pool.end();
  } catch (error) {
    console.error('Error cerrando conexiones de base de datos:', error);
  }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);