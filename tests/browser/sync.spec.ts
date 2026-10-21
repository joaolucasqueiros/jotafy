import { test, expect } from '@playwright/test';
import { demoData } from '../../src/lib/demo';

test('Update requests Meta sync before reading metrics and shows provider failures', async ({
  page,
}) => {
  const email = `sync-browser-${crypto.randomUUID()}@example.com`;
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const registration = await page.request.post('/api/auth/register', {
      headers: { origin: process.env.APP_URL || 'http://localhost:3000' },
      data: { name: 'Sync Test', email, password: 'sync-browser-test-password-123' },
    });
    expect(registration.ok()).toBeTruthy();
    let clicks = 10,
      visits = 7,
      fail = false,
      enqueue = false,
      workerDone = false;
    const sequence: string[] = [];
    await page.route('**/api/dashboard?*', async (route) => {
      sequence.push('dashboard');
      const fixture = demoData();
      await route.fulfill({
        json: {
          ...fixture,
          demo: false,
          workspaceId: 'browser-test-workspace',
          metaConnected: true,
          financials: {
            gross: 9000,
            net: 8000,
            netEstimated: true,
            fees: 1000,
            feesEstimated: false,
            refunded: 0,
            chargebackAmount: 0,
            pending: 0,
            confirmedNetOrders: 0,
            ticket: 9000,
            taxes: 0,
            adTax: 0,
            products: 0,
            expenses: 0,
            productsSummary: [],
            paymentSummary: [],
          },
          lastSync: new Date().toISOString(),
          summary: { ...fixture.summary, clicks, pageviews: visits },
        },
      });
    });
    await page.route('**/api/meta/sync*', async (route) => {
      if (route.request().method() === 'GET') {
        sequence.push('poll');
        if (workerDone) {
          clicks = 44;
          visits = 31;
        }
        await route.fulfill({
          json: {
            ok: true,
            pending: !workerDone,
            state: workerDone ? 'completed' : 'queued',
            jobId: '00000000-0000-4000-8000-000000000001',
            message: workerDone ? 'Meta sincronizada.' : 'Aguardando o serviço de sincronização.',
          },
        });
        return;
      }
      sequence.push('sync');
      if (enqueue && !fail) {
        await route.fulfill({
          status: 202,
          json: {
            ok: true,
            pending: true,
            state: 'queued',
            jobId: '00000000-0000-4000-8000-000000000001',
            message: 'Aguardando o serviço de sincronização.',
          },
        });
        return;
      }
      if (fail) await route.fulfill({ status: 502, json: { error: 'Token de teste expirado' } });
      else {
        clicks = 22;
        visits = 17;
        await route.fulfill({ json: { ok: true, pending: false, message: 'Meta sincronizada.' } });
      }
    });
    await page.clock.install();
    await page.goto('/');
    await page.clock.runFor(250);
    const counts = page.locator('[data-canvas-id="funnel"] .conversion-funnel-count');
    await expect(counts.nth(0)).toHaveText('10');
    await expect(page.locator('[data-canvas-id^="financial-"]')).toHaveCount(13);
    sequence.length = 0;
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await expect(counts.nth(0)).toHaveText('22');
    await expect(counts.nth(1)).toHaveText('17');
    expect(sequence).toEqual(['sync', 'dashboard']);
    clicks = 30;
    visits = 21;
    await page.clock.fastForward(31000);
    await expect(counts.nth(0)).toHaveText('30');
    await expect(counts.nth(1)).toHaveText('21');
    expect(sequence.filter((entry) => entry === 'sync')).toHaveLength(1);
    enqueue = true;
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await expect(page.locator('.sync-pending-notice')).toContainText('Aguardando o serviço');
    await page.clock.fastForward(31000);
    await expect(counts.nth(0)).toHaveText('30');
    expect(sequence.filter((entry) => entry === 'sync')).toHaveLength(2);
    workerDone = true;
    await page.clock.fastForward(31000);
    await expect(counts.nth(0)).toHaveText('44');
    await expect(counts.nth(1)).toHaveText('31');
    await expect(page.locator('.sync-pending-notice')).toHaveCount(0);
    fail = true;
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await expect(page.locator('.sync-error-notice')).toContainText('Token de teste expirado');
    await expect(counts.nth(0)).toHaveText('44');
  } finally {
    await pool.query('DELETE FROM users WHERE email=$1', [email]);
    await pool.end();
  }
});
