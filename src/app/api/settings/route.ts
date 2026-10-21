import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth';
import { query, transaction } from '@/lib/db';
import { handleError, sameOrigin, readJson } from '@/lib/http';
import { defaultCosts } from '@/lib/costs';
export async function GET() {
  try {
    const w = await requireWorkspace();
    const [c] = await query('SELECT * FROM cost_settings WHERE workspace_id=$1', [w.id]);
    return NextResponse.json({
      name: w.name,
      costs: c
        ? {
            salesTaxBps: c.sales_tax_bps,
            feeBps: c.fee_bps,
            adTaxBps: c.ad_tax_bps,
            productCost: Number(c.product_cost),
            dailyExpenses: Number(c.daily_expenses),
          }
        : defaultCosts,
    });
  } catch (e) {
    return handleError(e);
  }
}
const rate = z.number().int().min(0).max(10000),
  amount = z.number().int().min(0).max(100000000);
const schema = z.object({
  name: z.string().trim().min(2).max(100),
  costs: z.object({
    salesTaxBps: rate,
    feeBps: rate,
    adTaxBps: rate,
    productCost: amount,
    dailyExpenses: amount,
  }),
});
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const w = await requireWorkspace(),
      input = schema.parse(await readJson(request));
    const c = input.costs;
    await transaction(async (db) => {
      await db.query('UPDATE workspaces SET name=$2 WHERE id=$1', [w.id, input.name]);
      await db.query(
        `INSERT INTO cost_settings(workspace_id,sales_tax_bps,fee_bps,ad_tax_bps,product_cost,daily_expenses) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(workspace_id) DO UPDATE SET sales_tax_bps=$2,fee_bps=$3,ad_tax_bps=$4,product_cost=$5,daily_expenses=$6,updated_at=now()`,
        [w.id, c.salesTaxBps, c.feeBps, c.adTaxBps, c.productCost, c.dailyExpenses],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
