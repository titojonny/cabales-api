import { prisma, pool } from '../src/config/prisma.js';

async function main() {
  console.log('🌱 Sembrando datos iniciales en PostgreSQL...');

  const usuarios = [
    { nombre: 'Jonathan', email: 'jonathan@cabales.app', avatar_url: null },
    { nombre: 'Carlos', email: 'carlos@cabales.app', avatar_url: null },
    { nombre: 'Sofía', email: 'sofia@cabales.app', avatar_url: null },
    { nombre: 'Kevin', email: 'kevin@cabales.app', avatar_url: null },
  ];

  for (const u of usuarios) {
    await prisma.usuario.upsert({
      where: { email: u.email },
      update: { nombre: u.nombre },
      create: u,
    });
  }

  console.log('✅ Usuarios sembrados con éxito.');
}

main()
  .catch((e) => {
    console.error('❌ Error sembrando datos:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
