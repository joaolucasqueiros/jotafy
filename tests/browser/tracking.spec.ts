import { test, expect } from '@playwright/test';

test('tracking receives a test, monitors real PageView and displays a confirmed Meta receipt', async ({
  page,
}) => {
  const { Pool } = await import('pg');
  const { encrypt } = await import('../../src/lib/security');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const email = `tracking-${crypto.randomUUID()}@example.com`;
  try {
    const registration = await page.request.post('/api/auth/register', {
      headers: { origin: process.env.APP_URL || 'http://localhost:3000' },
      data: { name: 'Tracking QA', email, password: 'tracking-test-password-123' },
    });
    expect(registration.ok()).toBeTruthy();
    const {
      rows: [w],
    } = await pool.query(
      'UPDATE workspaces SET pixel_id=$2,capi_token=$3,allowed_origins=$4 WHERE user_id=(SELECT id FROM users WHERE email=$1) RETURNING id,public_key',
      [email, '1234567890', encrypt('qa-only-token'), ['https://store.example']],
    );
    const pageView = await page.request.post('/api/tracking', {
      headers: { origin: 'https://store.example' },
      data: {
        key: w.public_key,
        collectionMode: 'automatic',
        event: 'PageView',
        eventId: crypto.randomUUID(),
        clickId: crypto.randomUUID(),
        url: 'https://store.example/offer',
        fbp: 'fb.1.1234567890123.12345',
      },
    });
    expect(pageView.ok()).toBeTruthy();
    await page.goto('/?tab=tracking');
    const live = page.getByRole('region', { name: 'Eventos recebidos da página' });
    await expect(live).toContainText('PageView');
    await expect(live).toContainText('https://store.example/offer');
    const panel = page.getByRole('region', { name: 'Testar envio ao Facebook' });
    await panel.getByLabel('Código de teste da Meta').fill('TEST12345');
    await panel.getByLabel('Evento de teste').selectOption('Purchase');
    await panel.getByLabel('Autorizo enviar dados técnicos').check();
    await panel.getByRole('button', { name: 'Enviar evento de teste' }).click();
    await expect(panel.getByRole('status')).toContainText('Teste recebido pelo Jotafy');
    const row = panel.locator('tbody tr').first();
    await expect(row).toContainText('Aguardando processador');
    await expect(row).not.toContainText('Aceito pela Meta');
    const {
      rows: [job],
    } = await pool.query("SELECT id,payload FROM jobs WHERE workspace_id=$1 AND kind='capi_test'", [
      w.id,
    ]);
    expect(job.payload.test_event_code).toBe('TEST12345');
    // Simulate the worker's persisted acknowledgement, not an actual Meta request.
    await pool.query("UPDATE jobs SET status='completed',completed_at=now() WHERE id=$1", [job.id]);
    await pool.query(
      "INSERT INTO audit_log(workspace_id,action,target,details) VALUES($1,'tracking_test_accepted',$2,$3)",
      [w.id, job.id, JSON.stringify({ events_received: 1, fbtrace_id: 'qa-receipt-123' })],
    );
    await live.getByRole('button', { name: 'Atualizar eventos' }).click();
    await expect(row).toContainText('Aceito pela Meta');
    await expect(row).toContainText('1 evento recebido pela Meta');
    await expect(row).toContainText('qa-receipt-123');
    const {
      rows: [count],
    } = await pool.query('SELECT count(*)::int AS count FROM orders WHERE workspace_id=$1', [w.id]);
    expect(count.count).toBe(0);
    await panel.screenshot({ path: 'test-results/tracking-tests.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  } finally {
    await pool.query('DELETE FROM users WHERE email=$1', [email]);
    await pool.end();
  }
});
