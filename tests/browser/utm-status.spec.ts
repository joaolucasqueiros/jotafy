import { test, expect } from '@playwright/test';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
test('UTM status shows evidence, verifies again and does not keep a green badge on error', async ({
  page,
  baseURL,
}) => {
  const email = `utm-status-${crypto.randomUUID()}@example.com`;
  try {
    const registration = await page.request.post('/api/auth/register', {
      headers: { origin: baseURL! },
      data: { name: 'UTM Status', email, password: 'integration-password-123' },
    });
    expect(registration.status()).toBe(200);
    let calls = 0;
    let fail = false;
    await page.route('**/api/utms/status', async (route) => {
      calls++;
      if (fail) return route.fulfill({ status: 503, json: { error: 'Serviço indisponível' } });
      return route.fulfill({
        json: {
          checkedAt: new Date().toISOString(),
          campaigns: [
            {
              id: '123',
              name: 'Campanha UTM',
              campaignStatus: 'ACTIVE',
              state: 'receiving',
              events24h: 5,
              checkouts24h: 2,
              lastReceivedAt: new Date().toISOString(),
            },
            {
              id: '456',
              name: 'Sem visita ainda',
              campaignStatus: 'ACTIVE',
              state: 'no_events',
              events24h: 0,
              checkouts24h: 0,
              lastReceivedAt: null,
            },
          ],
        },
      });
    });
    await page.goto('/?tab=utms');
    await expect(page.getByText('Rastreamento ativo', { exact: true })).toBeVisible();
    await expect(page.getByText('Aguardando primeiro evento', { exact: true })).toBeVisible();
    fail = true;
    await page.getByRole('button', { name: 'Verificar UTMs' }).click();
    await expect(
      page.getByRole('region', { name: 'Status de rastreamento das UTMs' }).getByRole('alert'),
    ).toContainText('O status não pôde ser confirmado');
    await expect(page.getByText('Rastreamento ativo', { exact: true })).toHaveCount(0);
    expect(calls).toBeGreaterThanOrEqual(2);
  } finally {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email=$1', [email]);
    await pool.end();
  }
});
