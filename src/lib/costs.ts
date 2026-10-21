export type Costs = {
  salesTaxBps: number;
  feeBps: number;
  adTaxBps: number;
  productCost: number;
  dailyExpenses: number;
};
export const defaultCosts: Costs = {
  salesTaxBps: 0,
  feeBps: 0,
  adTaxBps: 0,
  productCost: 0,
  dailyExpenses: 0,
};
export function estimateCosts(
  revenue: number,
  spend: number,
  sales: number,
  days: number,
  costs: Costs,
  filtered = false,
) {
  const taxes = Math.round((revenue * costs.salesTaxBps) / 10000);
  const fees = Math.round((revenue * costs.feeBps) / 10000);
  const adTax = Math.round((spend * costs.adTaxBps) / 10000);
  const products = sales * costs.productCost;
  // Workspace-wide fixed costs cannot be attributed to a single campaign without an allocation policy.
  const expenses = filtered ? 0 : days * costs.dailyExpenses;
  return {
    taxes,
    fees,
    adTax,
    products,
    expenses,
    total: taxes + fees + adTax + products + expenses,
  };
}
