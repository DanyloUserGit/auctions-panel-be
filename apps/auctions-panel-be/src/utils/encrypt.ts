import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const algorithm = 'aes-256-cbc';

const getKey = () => {
  const password = process.env.ENCRYPT_PASS;
  const salt = process.env.ENCRYPT_SALT;

  if (!password || !salt) {
    throw new Error('ENCRYPT_PASS or ENCRYPT_SALT is not defined in .env');
  }

  return scryptSync(password, salt, 32);
};

export const encryptData = (text: string) => {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
};

export const decryptData = (encryptedData: string) => {
  const key = getKey();
  const [ivHex, encryptedText] = encryptedData.split(':');
  if (!ivHex || !encryptedText) throw new Error('Invalid encrypted data format');

  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};
