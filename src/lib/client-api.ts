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
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir.');
  return body;
}
