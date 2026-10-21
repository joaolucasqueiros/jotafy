import { appUrl, assertEncryptionConfigured, HttpError } from './security';

// Validate before consulting the session or creating OAuth cookies. Never return secret values.
export function metaOAuthConfig() {
  const appId = process.env.META_APP_ID?.trim();
  if (!appId)
    throw new HttpError(
      503,
      'Configure META_APP_ID nas variáveis de runtime do Cloudflare.',
      'META_APP_ID_MISSING',
    );
  if (!/^\d+$/.test(appId))
    throw new HttpError(
      503,
      'META_APP_ID inválido: use somente o ID numérico do aplicativo Meta.',
      'META_APP_ID_INVALID',
    );
  if (!process.env.META_APP_SECRET?.trim())
    throw new HttpError(
      503,
      'Configure META_APP_SECRET como segredo de runtime no Cloudflare.',
      'META_APP_SECRET_MISSING',
    );
  assertEncryptionConfigured();
  const rawUrl = process.env.APP_URL || appUrl();
  let base: URL;
  try {
    base = new URL(rawUrl);
  } catch {
    throw new HttpError(
      503,
      'APP_URL inválida: informe a origem HTTPS pública do painel.',
      'APP_URL_INVALID',
    );
  }
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    !(base.protocol === 'https:' || (base.protocol === 'http:' && base.hostname === 'localhost'))
  ) {
    throw new HttpError(
      503,
      'APP_URL deve conter somente a origem HTTPS do painel, sem /api, caminho, parâmetros ou fragmento.',
      'APP_URL_INVALID',
    );
  }
  const version = process.env.META_GRAPH_VERSION || 'v25.0';
  if (!/^v\d+\.\d+$/.test(version))
    throw new HttpError(
      503,
      'META_GRAPH_VERSION inválida. Use o formato v25.0.',
      'META_GRAPH_VERSION_INVALID',
    );
  return { appId, callbackUrl: `${base.origin}/api/auth/meta/callback`, version };
}
