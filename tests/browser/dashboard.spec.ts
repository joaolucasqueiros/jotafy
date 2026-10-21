import { test, expect } from '@playwright/test';
test('dashboard navigation, period filters, sales, campaign controls and UTM generator', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Visão geral.' })).toBeVisible();
  await expect(page.getByText('DEMONSTRAÇÃO', { exact: true })).toBeVisible();
  await page.getByLabel('Período', { exact: true }).selectOption('30');
  await expect(page.getByText('Últimos 30 dias', { exact: true }).last()).toBeVisible();
  await page.locator('nav').getByRole('button', { name: 'Meta Ads' }).click();
  const toggle = page.getByRole('switch').first();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(page.getByRole('heading', { name: 'Pausar veiculação' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar alteração' }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.locator('nav').getByRole('button', { name: 'Vendas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Histórico de vendas' })).toBeVisible();
  await page.getByLabel('Status da venda').selectOption('refunded');
  await expect(page.locator('tbody .sale-status').first()).toHaveText('Reembolsada');
  await page.locator('tbody').getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Origem da venda' })).toBeVisible();
  await page.getByLabel('Fechar venda').click();
  await page.locator('nav').getByRole('button', { name: 'Gerador de UTMs' }).click();
  await page.getByLabel('URL da página de destino').fill('https://example.com/oferta?offer=1');
  await expect(page.locator('.utm-output code')).toContainText('offer=1&utm_source=meta');
  await expect(page.locator('.utm-output code')).toContainText('{{campaign.id}}');
  await page.locator('nav').getByRole('button', { name: 'Integrações' }).click();
  await expect(page.getByRole('heading', { name: 'Webhook da Cakto' })).toBeVisible();
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByRole('status')).toContainText('Crie uma conta');
  expect(errors).toEqual([]);
});
test('responsive dashboard has no horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.recharts-area-curve').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/metatrack-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByLabel('Abrir menu').click();
  await page.locator('nav').getByRole('button', { name: 'Integrações' }).click();
  await expect(page.getByRole('heading', { name: 'Webhook da Cakto' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
test('desktop screenshot and login/register form', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/metatrack-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Conectar minha operação' }).click();
  await expect(page.getByRole('heading', { name: 'Bom ter você de volta.' })).toBeVisible();
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByLabel('Seu nome')).toBeVisible();
  await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('minlength', '12');
});

test('a real account starts empty, persists workspace costs and can sign out', async ({ page }) => {
  const email = `browser-${crypto.randomUUID()}@example.com`;
  try {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await page.getByLabel('Seu nome').fill('Browser Tester');
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Senha', { exact: true }).fill('browser-test-password-123');
    await page.getByRole('button', { name: 'Criar minha conta', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Visão geral.' })).toBeVisible();
    await expect(page.getByText('DEMONSTRAÇÃO', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByLabel('Nome do workspace').fill('Operação de teste');
    await page.getByLabel('Impostos sobre vendas (%)').fill('6');
    await page.getByLabel('Taxa média da plataforma (%)').fill('5');
    await page.getByRole('button', { name: 'Salvar custos' }).click();
    await expect(page.getByRole('status')).toContainText('Custos salvos');
    await page.reload();
    await expect(page.getByLabel('Nome do workspace')).toHaveValue('Operação de teste');
    await expect(page.getByLabel('Impostos sobre vendas (%)')).toHaveValue('6');
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.getByText('DEMONSTRAÇÃO', { exact: true })).toBeVisible();
  } finally {
    const { db } = await import('../../src/lib/db');
    await db.query('DELETE FROM users WHERE email=$1', [email]);
    await db.end();
  }
});
