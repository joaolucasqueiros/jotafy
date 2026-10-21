import { test, expect } from '@playwright/test';

test('layout preferences reorder actual sections, hide blocks and survive reload; cancel and reset work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Opções de exibição' }).click();
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
  await expect(page.locator('.canvas-grid > [data-layout-section]').first()).toHaveAttribute(
    'data-layout-section',
    'funnel',
  );
  await expect(page.locator('[data-layout-section="connections"]')).toHaveCount(0);
  await expect(page.locator('.overview-layout')).toHaveClass(/layout-columns-2/);
  await page.reload();
  await expect(page.locator('.overview-layout')).toHaveClass(/layout-density-compact/);
  await expect(page.locator('.canvas-grid > [data-layout-section]').first()).toHaveAttribute(
    'data-layout-section',
    'funnel',
  );
  await page.getByRole('button', { name: 'Opções de exibição' }).click();
  await dialog.getByLabel('Cards por linha no computador').selectOption('3');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('.overview-layout')).toHaveClass(/layout-columns-2/);
  await page.getByRole('button', { name: 'Opções de exibição' }).click();
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
  await page.getByRole('button', { name: 'Opções de exibição' }).click();
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
  await expect(page.locator('[data-layout-section="metrics"]').first()).toBeVisible();
});

test('canvas supports mouse dragging and corner resizing with persistence and discard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Editar layout visual', exact: true }).click();
  const card = page.locator('[data-canvas-id="metric-0"]');
  const initial = (await card.boundingBox())!;
  const handle = (await card.locator('.react-resizable-handle-se').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 150, handle.y + 80, { steps: 15 });
  await page.mouse.up();
  await expect
    .poll(async () => (await card.boundingBox())!.width)
    .toBeGreaterThan(initial.width + 50);
  const grip = (await card.locator('.canvas-drag-handle').boundingBox())!;
  await page.mouse.move(grip.x + 50, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 340, grip.y + 200, { steps: 18 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Concluir edição', exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('metatrack:dashboard-layout:v1:demo')!),
  );
  const geometry = saved.canvas.find((item: { i: string }) => item.i === 'metric-0');
  expect(geometry.w).toBeGreaterThan(3);
  expect(geometry.x > 0 || geometry.y > 0).toBeTruthy();
  await page.reload();
  await expect(card).toBeVisible();
  const afterReload = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('metatrack:dashboard-layout:v1:demo')!),
  );
  expect(afterReload.canvas.find((item: { i: string }) => item.i === 'metric-0')).toEqual(geometry);
  await page.getByRole('button', { name: 'Editar layout visual', exact: true }).click();
  await page.getByRole('button', { name: 'Restaurar padrão', exact: true }).click();
  await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('metatrack:dashboard-layout:v1:demo')!).canvas.find(
        (item: { i: string }) => item.i === 'metric-0',
      ),
    ),
  ).toEqual(geometry);
  expect(errors).toEqual([]);
});
