import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ValidationError } from '../errors';

const ALGORITHM = 'aes-256-gcm';

function keyFromMaster(masterKey: string): Buffer {
  return createHash('sha256').update(masterKey).digest();
}

export function encryptSecret(secret: string, masterKey: string): string {
  if (!masterKey.trim()) {
    throw new ValidationError('OCO_ADMIN_MASTER_KEY must be set');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyFromMaster(masterKey), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(payload: string, masterKey: string): string {
  const [ivRaw, tagRaw, dataRaw] = payload.split('.');
  if (!ivRaw || !tagRaw || !dataRaw) {
    throw new ValidationError('invalid encrypted payload');
  }

  const iv = Buffer.from(ivRaw, 'base64url');
  const tag = Buffer.from(tagRaw, 'base64url');
  const encrypted = Buffer.from(dataRaw, 'base64url');

  const decipher = createDecipheriv(ALGORITHM, keyFromMaster(masterKey), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function secretLast4(secret: string): string {
  const compact = secret.replace(/\s+/g, '');
  return compact.slice(-4).padStart(4, '*');
}
