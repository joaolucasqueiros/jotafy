import { test, expect } from '@playwright/test';

test('layout preferences reorder actual sections, hide blocks and survive reload; cancel and reset work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Personalizar painel' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Cards por linha no computador').selectOption('2');
  await dialog.getByLabel('Espaçamento', { exact: true }).selectOption('compact');
  await dialog.getByLabel('Tamanho dos valores').selectOption('large');
  await dialog.getByLabel('Saúde das integrações', { exact: true }).uncheck();
  await dialog.getByLabel('Largura de Funil de conversão').selectOption('full');
  for (let i = 0; i < 6; i++)
    await dialog
      .getByRole('button', { name: 'Mover Funil de conversão para cima', exact: true })
      .click();
  await dialog.getByRole('button', { name: 'Salvar layout' }).click();
  await expect(page.locator('.overview-layout > [data-layout-section]').first()).toHaveAttribute(
    'data-layout-section',
    'funnel',
  );
  await expect(page.locator('[data-layout-section="connections"]')).toHaveCount(0);
  await expect(page.locator('.overview-layout')).toHaveClass(/layout-columns-2/);
  await page.reload();
  await expect(page.locator('.overview-layout')).toHaveClass(/layout-density-compact/);
  await expect(page.locator('.overview-layout > [data-layout-section]').first()).toHaveAttribute(
    'data-layout-section',
    'funnel',
  );
  await page.getByRole('button', { name: 'Personalizar painel' }).click();
  await dialog.getByLabel('Cards por linha no computador').selectOption('3');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('.overview-layout')).toHaveClass(/layout-columns-2/);
  await page.getByRole('button', { name: 'Personalizar painel' }).click();
  await dialog.getByRole('button', { name: 'Restaurar padrão' }).click();
  await dialog.getByRole('button', { name: 'Salvar layout' }).click();
  await expect(page.locator('.overview-layout')).toHaveClass(/layout-columns-4/);
  await expect(page.locator('[data-layout-section="connections"]')).toBeVisible();
});

test('mobile customization dialog and narrow sections do not overflow the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Personalizar painel' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await dialog.getByLabel('Largura de Indicadores principais').selectOption('narrow');
  await dialog.getByRole('button', { name: 'Salvar layout' }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await expect(page.locator('[data-layout-section="metrics"]')).toBeVisible();
});
