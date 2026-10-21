import { z } from 'zod';
import { sha256, equal, HttpError } from './security';
// Cakto webhook: shared secret in the JSON body. Do not invent an official HMAC header.
const scalar = z
  .union([z.string().min(1).max(128), z.number().int().nonnegative()])
  .transform(String);
const optString = z
  .string()
  .max(1024)
  .nullish()
  .transform((v) => v || undefined);
const utms = z.object({
  utm_source: optString,
  utm_medium: optString,
  utm_campaign: optString,
  utm_content: optString,
  utm_term: optString,
  mt_click: z
    .string()
    .uuid()
    .nullish()
    .transform((v) => v || undefined),
});
export const caktoPayload = z.object({
  secret: z.string().min(1),
  event: z.string().min(1),
  id: scalar.optional(),
  data: z.object({
    id: scalar,
    status: optString,
    amount: z.union([z.string(), z.number()]),
    currency: z.string().default('BRL'),
    createdAt: optString,
    approvedDate: z.string().nullable().optional(),
    updatedAt: optString,
    customer: z.object({ email: optString }).optional(),
    product: z.object({ name: z.string().max(300) }).optional(),
    paymentMethod: optString,
    utm_source: optString,
    utm_medium: optString,
    utm_campaign: optString,
    utm_content: optString,
    utm_term: optString,
    utm: utms.nullish(),
    tracking: utms.nullish(),
    metadata: z
      .object({
        mt_click: z
          .string()
          .uuid()
          .nullish()
          .transform((v) => v || undefined),
      })
      .optional(),
  }),
});
const statuses: Record<string, string> = {
  purchase_approved: 'approved',
  purchase_pending: 'pending',
  pix_generated: 'pending',
  boleto_generated: 'pending',
  purchase_canceled: 'refused',
  purchase_refused: 'refused',
  purchase_refunded: 'refunded',
  chargeback: 'chargeback',
  purchase_chargeback: 'chargeback',
};
export function normalizeCakto(input: unknown, expectedSecret: string) {
  const payload = caktoPayload.parse(input);
  if (!equal(payload.secret, expectedSecret))
    throw new HttpError(401, 'Autenticação do webhook inválida.');
  const status = statuses[payload.event];
  if (!status) return null;
  const d = payload.data;
  const amount = Number(d.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e10)
    throw new HttpError(400, 'Valor inválido.');
  const when = d.updatedAt || (status === 'approved' ? d.approvedDate : null) || d.createdAt;
  if (!when || !Number.isFinite(Date.parse(when)))
    throw new HttpError(400, 'Evento sem data válida (updatedAt/approvedDate/createdAt).');
  if (d.currency !== 'BRL') throw new HttpError(422, 'Este workspace aceita vendas em BRL.');
  const tracking = { ...d, ...d.utm, ...d.tracking };
  return {
    eventKey: payload.id || sha256(JSON.stringify({ event: payload.event, data: d })),
    eventName: payload.event,
    externalId: d.id,
    status,
    amount: Math.round(amount * 100),
    currency: d.currency,
    occurredAt: new Date(when),
    product: d.product?.name || 'Produto Cakto',
    customerHash: d.customer?.email ? sha256(d.customer.email.trim().toLowerCase()) : null,
    paymentMethod: d.paymentMethod || null,
    clickId: d.metadata?.mt_click || d.tracking?.mt_click || d.utm?.mt_click || null,
    campaignId: tracking.utm_campaign || null,
    adsetId: tracking.utm_term || null,
    adId: tracking.utm_content || null,
  };
}
export function canTransition(previous: string, next: string) {
  if (previous === 'chargeback') return next === 'chargeback';
  if (previous === 'refunded') return next === 'chargeback' || next === 'refunded';
  if (previous === 'approved') return next !== 'pending' && next !== 'refused';
  return true;
}
