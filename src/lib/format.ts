export const money = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const number = (n: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(n);
export const percent = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export function dateRange(days: number) {
  const end = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const d = new Date(end + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - days + 1);
  return { start: d.toISOString().slice(0, 10), end };
}
