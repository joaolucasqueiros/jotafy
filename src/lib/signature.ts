import { createHmac } from 'node:crypto';
import { equal } from './security';
// Optional relay contract, NOT an official Cakto signature protocol.
export function verifyRelaySignature(raw: string, signature: string | null, secret: string) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return equal(signature, expected);
}
