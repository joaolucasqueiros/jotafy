import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('hex');
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, hash: string) {
  const [salt, derived] = hash.split(':');
  return !!salt && !!derived && equal(scryptSync(password, salt, 64).toString('hex'), derived);
}
function key() {
  const k = Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64');
  if (k.length !== 32)
    throw new HttpError(
      503,
      'ENCRYPTION_KEY ausente ou inválida no servidor. Configure a chave original de 32 bytes em base64 nas variáveis de runtime do Cloudflare.',
      'ENCRYPTION_KEY_INVALID',
    );
  return k;
}
export function assertEncryptionConfigured() {
  key();
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((v) => v.toString('base64url')).join('.');
}
export function decrypt(value: string) {
  const [iv, tag, encrypted] = value.split('.').map((v) => Buffer.from(v, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
}
export function appUrl() {
  const url = process.env.APP_URL || 'http://localhost:3000';
  if (
    process.env.NODE_ENV === 'production' &&
    !url.startsWith('https://') &&
    !url.includes('localhost')
  )
    throw new Error('APP_URL deve usar HTTPS.');
  return url.replace(/\/$/, '');
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
