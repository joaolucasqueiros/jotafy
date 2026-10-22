'use client';
export async function api(url: string, data?: unknown) {
  const response = await fetch(
    url,
    data === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    if (/Worker exceeded resource limits|error_1102|error-code[^>]*>1102/i.test(text)) {
      const path = new URL(url, 'https://painel.local').pathname;
      const method = data === undefined ? 'GET' : 'POST';
      const nextStep =
        path === '/api/meta/sync' || path === '/api/jobs'
          ? 'Confirme a versão publicada e o processador Node/GitHub Actions. A sincronização web deve apenas entrar na fila.'
          : 'Confira os logs dessa rota na Cloudflare. Ativar o processador não corrige, por si só, esse erro na aplicação web.';
      throw new Error(
        `A Cloudflare interrompeu ${method} ${path} por limite de recursos (1102). ${nextStep}`,
      );
    }
    throw new Error(
      `O servidor retornou uma resposta inválida (HTTP ${response.status}). Tente novamente e confira os logs do serviço.`,
    );
  }
  if (!body || typeof body !== 'object')
    throw new Error('O servidor retornou uma resposta inválida.');
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir.');
  return body;
}
