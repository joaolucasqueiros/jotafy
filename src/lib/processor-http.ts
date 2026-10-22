import { createServer } from 'node:http';
import { equal } from './security';

export function createProcessorServer(options: {
  secret: string;
  process: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}) {
  if (options.secret.trim().length < 32)
    throw new Error('CRON_SECRET precisa ter pelo menos 32 caracteres.');
  let active: Promise<void> | null = null;
  const server = createServer((request, response) => {
    const path = (request.url || '/').split('?')[0];
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    request.resume();
    if (request.method === 'GET' && path === '/health') {
      response.writeHead(200).end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method !== 'POST' || path !== '/api/jobs') {
      response.writeHead(404).end(JSON.stringify({ error: 'Não encontrado.' }));
      return;
    }
    if (!equal(request.headers.authorization || '', `Bearer ${options.secret}`)) {
      response.writeHead(401).end(JSON.stringify({ error: 'Não autorizado.' }));
      return;
    }
    const alreadyRunning = active !== null;
    // Return promptly so the scheduler's HTTP timeout does not interrupt the cycle.
    // Acceptance is not confirmation of Meta delivery; the dashboard reads the jobs.
    response.writeHead(202).end(JSON.stringify({ accepted: true, alreadyRunning }));
    if (!alreadyRunning) {
      active = Promise.resolve()
        .then(options.process)
        .then(() => undefined)
        .catch((error) => options.onError?.(error))
        .finally(() => {
          active = null;
        });
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  return { server, waitForIdle: () => active || Promise.resolve() };
}
