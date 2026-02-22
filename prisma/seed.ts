// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import * as path from 'path';
import { hashPassword } from '../src/utils/password';

config({ path: path.resolve(__dirname, '../.env') });
console.log('DATABASE_URL =', process.env.DATABASE_URL);
const prisma = new PrismaClient();

const getSeedCredentials = () => {
  const seedUserEmail = process.env.SEED_USER_EMAIL || 'user@example.com';
  const seedUserPassword = process.env.SEED_USER_PASSWORD || '1Qwerty!';

  const seedAdminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD || '1Qwerty!';

  if (!process.env.SEED_USER_EMAIL || !process.env.SEED_ADMIN_EMAIL) {
    console.warn(
      '⚠️ Using default test credentials. For production, set SEED_USER_EMAIL/PASSWORD and SEED_ADMIN_EMAIL/PASSWORD.'
    );
  }

  return {
    seedUserEmail,
    seedUserPassword,
    seedAdminEmail,
    seedAdminPassword,
  };
};

const createUserData = async () => {
  const { seedUserEmail, seedUserPassword } = getSeedCredentials();

  return {
    email: seedUserEmail,
    password: await hashPassword(seedUserPassword),
    firstName: 'User',
    lastName: 'Default',
    role: 'User',
  };
};

const createAdminData = async () => {
  const { seedAdminEmail, seedAdminPassword } = getSeedCredentials();

  return {
    email: seedAdminEmail,
    password: await hashPassword(seedAdminPassword),
    firstName: 'Admin',
    lastName: '',
    role: 'Admin',
  };
};

async function main() {
  console.info('🌱 Start seeding...');
  console.log('DB URL:', process.env.DATABASE_URL);

  /// --------- Users ---------------
  const userData = await createUserData();
  const adminData = await createAdminData();

  const user = await prisma.user.upsert({
    where: { email: userData.email },
    update: {},
    create: userData,
  });

  console.info('✅ User created:', { email: user.email, role: user.role });

  const admin = await prisma.user.upsert({
    where: { email: adminData.email },
    update: {},
    create: adminData,
  });

  console.info('✅ Admin created:', { id: admin.id, email: admin.email, role: admin.role });

  console.info('🎉 Seeding finished successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });