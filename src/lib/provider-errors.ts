// Provider messages can echo credentials. Sanitize before storing, logging or returning them.
export function safeProviderMessage(value: unknown, secrets: string[] = []): string {
  let message = typeof value === 'string' ? value : 'Falha no provedor';
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(secret).join('[redacted]');
    message = message.split(encodeURIComponent(secret)).join('[redacted]');
  }
  return message
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/\bEA[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .replace(
      /\b(access_token|appsecret_proof|client_secret|password)\s*[=:]\s*[^\s&,;"']+/gi,
      '$1=[redacted]',
    )
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"']+/gi, '[URL redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 300);
}
