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
    if (/Worker exceeded resource limits|error_1102|error-code[^>]*>1102/i.test(text))
      throw new Error(
        'A Cloudflare interrompeu a execução por limite de recursos (1102). O processamento deve ser executado pelo serviço Node.',
      );
    throw new Error(
      `O servidor retornou uma resposta inválida (HTTP ${response.status}). Tente novamente e confira os logs do serviço.`,
    );
  }
  if (!body || typeof body !== 'object')
    throw new Error('O servidor retornou uma resposta inválida.');
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir.');
  return body;
}
