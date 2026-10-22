import type { PoolClient } from 'pg';
import { randomToken, sha256, equal, HttpError } from './security';

const defaultPublicKey = '78594b3ef8fa8f290ccfb58db15346313f8a81f780f68094104a27c878c0e8ab';
const productName = () =>
  process.env.DELIVERY_PRODUCT_NAME || 'Pequenos Construtores — 131 Projetos Criativos';
const workspaceKey = () => process.env.DELIVERY_WORKSPACE_PUBLIC_KEY || defaultPublicKey;
const tokenValid = (token: unknown): token is string =>
  typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const sameProduct = (name: string) => name === productName();

function configuredDeliverySecret() {
  const secret = process.env.DELIVERY_SERVICE_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret))
    throw new HttpError(503, 'Configure a entrega segura de materiais no servidor.');
  return secret;
}
export function requireDeliveryService(request: Request) {
  const secret = configuredDeliverySecret();
  if (!equal(request.headers.get('authorization') || '', `Bearer ${secret}`))
    throw new HttpError(401, 'Acesso não autorizado.');
}

export async function issueDeliveryAccess(
  client: PoolClient,
  workspaceId: string,
  orderId: string,
) {
  // Refuse configuration errors before producing a customer link.
  configuredDeliverySecret();
  const origin = new URL(
    process.env.MUNDO_CRIATIVO_ORIGIN || 'https://mundocriativo.joaolucasqueirozag.workers.dev',
  );
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new HttpError(503, 'Configure a origem HTTPS da página de obrigado.');
  const {
    rows: [order],
  } = await client.query(
    `SELECT o.id,o.status,o.product,w.public_key FROM orders o JOIN workspaces w ON w.id=o.workspace_id
     WHERE o.id=$1 AND o.workspace_id=$2 AND o.provider='cakto'`,
    [orderId, workspaceId],
  );
  if (!order || order.public_key !== workspaceKey())
    throw new HttpError(404, 'Pedido não disponível para este material.');
  if (order.status !== 'approved')
    throw new HttpError(409, 'O material só pode ser liberado para pedidos aprovados.');
  if (!sameProduct(order.product)) throw new HttpError(409, 'Este pedido é de outro produto.');
  const grant = randomToken();
  const {
    rows: [access],
  } = await client.query(
    `INSERT INTO delivery_access(workspace_id,order_id,grant_hash,grant_expires_at)
     VALUES($1,$2,$3,now()+interval '24 hours') RETURNING id,grant_expires_at`,
    [workspaceId, orderId, sha256(grant)],
  );
  await client.query(
    "INSERT INTO audit_log(workspace_id,action,target,details) VALUES($1,'delivery_access_issued',$2,$3)",
    [workspaceId, orderId, JSON.stringify({ access_id: access.id })],
  );
  // Fragment credentials are not sent as a page URL, referrer or query parameter.
  return { url: `${origin.origin}/obrigado/#acesso=${grant}`, expiresAt: access.grant_expires_at };
}

export async function redeemDeliveryAccess(
  client: PoolClient,
  grant: string,
  session = randomToken(),
) {
  if (!tokenValid(grant) || !tokenValid(session)) return null;
  // One-use redemption and approval check happen atomically, including a concurrent refund.
  const {
    rows: [access],
  } = await client.query(
    `WITH eligible AS (
      SELECT d.id FROM delivery_access d JOIN orders o ON o.id=d.order_id AND o.workspace_id=d.workspace_id
      JOIN workspaces w ON w.id=d.workspace_id
      WHERE d.grant_hash=$1 AND d.grant_expires_at>now()
      AND (d.redeemed_at IS NULL OR d.session_hash=$4)
      AND (d.session_expires_at IS NULL OR d.session_expires_at>now())
      AND o.status='approved' AND o.provider='cakto' AND w.public_key=$2 AND o.product=$3
      FOR UPDATE OF d,o
    ) UPDATE delivery_access d SET redeemed_at=COALESCE(d.redeemed_at,now()),session_hash=$4,
      session_expires_at=COALESCE(d.session_expires_at,now()+interval '30 days')
    FROM eligible e WHERE d.id=e.id AND (d.redeemed_at IS NULL OR d.session_hash=$4)
    RETURNING d.id,d.workspace_id,d.session_expires_at`,
    [sha256(grant), workspaceKey(), productName(), sha256(session)],
  );
  if (!access) return null;
  await client.query(
    "INSERT INTO audit_log(workspace_id,action,target) VALUES($1,'purchase_access_verified',$2)",
    [access.workspace_id, access.id],
  );
  return { session, expiresAt: access.session_expires_at };
}

export async function checkDeliveryAccess(client: PoolClient, session: string) {
  if (!tokenValid(session)) return null;
  const {
    rows: [access],
  } = await client.query(
    `SELECT d.id,d.workspace_id,d.session_expires_at,o.status,o.product,w.public_key
     FROM delivery_access d JOIN orders o ON o.id=d.order_id AND o.workspace_id=d.workspace_id
     JOIN workspaces w ON w.id=d.workspace_id
     WHERE d.session_hash=$1 AND d.session_expires_at>now() AND o.provider='cakto'`,
    [sha256(session)],
  );
  if (!access || access.public_key !== workspaceKey() || !sameProduct(access.product)) return null;
  if (access.status === 'pending') return { status: 'pending' as const };
  if (access.status !== 'approved') return null;
  return {
    status: 'approved' as const,
    id: access.id,
    workspaceId: access.workspace_id,
    expiresAt: access.session_expires_at,
  };
}

export const deliveryEvents = [
  'thank_you_page_view',
  'purchase_access_verified',
  'download_started',
  'download_completed',
  'download_failed',
] as const;
export async function recordDeliveryEvent(
  client: PoolClient,
  session: string,
  event: (typeof deliveryEvents)[number],
) {
  const access = await checkDeliveryAccess(client, session);
  if (!access || access.status !== 'approved') return false;
  await client.query('INSERT INTO audit_log(workspace_id,action,target) VALUES($1,$2,$3)', [
    access.workspaceId,
    event,
    access.id,
  ]);
  return true;
}
