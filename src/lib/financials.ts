import { sha256 } from './security';
export type FinancialOrder = {
  amount: string | number;
  provider_fees: string | number | null;
  commission_breakdown: { userHash: string; type: string; amount: number }[] | null;
};
export function financialSummary(
  orders: FinancialOrder[],
  email: string | null | undefined,
  feeBps: number,
) {
  const hash = email ? sha256(email.trim().toLowerCase()) : null;
  let net = 0,
    fees = 0,
    confirmed = 0,
    reportedFees = 0;
  for (const order of orders) {
    const amount = Number(order.amount);
    const fee =
      order.provider_fees == null
        ? Math.round((amount * feeBps) / 10000)
        : Number(order.provider_fees);
    fees += fee;
    if (order.provider_fees != null) reportedFees++;
    const own = hash ? order.commission_breakdown?.filter((c) => c.userHash === hash) : null;
    if (own?.length) {
      // Cakto commission is already the participant's proceeds: never subtract its fees again.
      net += own.reduce((sum, c) => sum + c.amount, 0);
      confirmed++;
    } else net += Math.max(0, amount - fee);
  }
  return {
    net,
    fees,
    confirmed,
    reportedFees,
    estimated: orders.length === 0 || confirmed !== orders.length,
  };
}
