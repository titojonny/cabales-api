import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/** Construye el cliente PostgreSQL sin conectarse hasta la primera operación. */
export function createDatabase(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

/** Cliente de infraestructura compartido por los repositorios. */
export type Database = PrismaClient;
