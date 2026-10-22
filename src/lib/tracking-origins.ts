import { z } from 'zod';

// Accept pasted hostnames and a trailing slash while preserving an exact CORS origin.
export const trackingOrigin = z
  .string()
  .trim()
  .transform((input, ctx) => {
    try {
      const value = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
      const url = new URL(value);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        !input ||
        /\s|\*/.test(input) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
      ) {
        throw new Error();
      }
      return url.origin;
    } catch {
      ctx.addIssue({
        code: 'custom',
        message:
          'Informe um domínio HTTPS sem caminho, parâmetros ou credenciais. Ex.: https://seusite.com.br',
      });
      return z.NEVER;
    }
  });

export const trackingOrigins = z
  .array(trackingOrigin)
  .max(20)
  .transform((origins) => [...new Set(origins)]);
