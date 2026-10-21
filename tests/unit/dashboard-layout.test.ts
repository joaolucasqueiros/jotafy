import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasLayout,
  normalizeCanvas,
  defaultDashboardLayout,
  layoutSections,
  normalizeDashboardLayout,
} from '../../src/lib/dashboard-layout';

test('layout restores safe defaults for corrupt or unsupported preferences', () => {
  for (const input of [
    null,
    'bad',
    { version: 2 },
    { version: 1, columns: 999, density: '<script>' },
  ]) {
    assert.deepEqual(normalizeDashboardLayout(input), defaultDashboardLayout());
  }
});
test('layout keeps custom ordering, widths and visibility while repairing missing sections', () => {
  const result = normalizeDashboardLayout({
    version: 1,
    columns: 2,
    textSize: 'large',
    density: 'compact',
    sections: [
      { id: 'funnel', width: 'half', visible: true },
      { id: 'metrics', width: 'invalid', visible: false },
      { id: 'funnel', width: 'narrow', visible: false },
      { id: 'unknown', width: 'full', visible: true },
    ],
  });
  assert.equal(result.sections.length, layoutSections.length);
  assert.deepEqual(result.sections[0], { id: 'funnel', width: 'half', visible: true });
  assert.deepEqual(result.sections[1], { id: 'metrics', width: 'full', visible: false });
  assert.equal(result.columns, 2);
  assert.equal(result.textSize, 'large');
  assert.equal(result.density, 'compact');
});
test('layout cannot permanently hide every section and defaults are independent', () => {
  const defaults = defaultDashboardLayout();
  const result = normalizeDashboardLayout({
    ...defaults,
    sections: defaults.sections.map((s) => ({ ...s, visible: false })),
  });
  assert(result.sections.some((s) => s.visible));
  defaults.sections[0].visible = false;
  assert.equal(defaultDashboardLayout().sections[0].visible, true);
});

test('canvas clamps malicious or invalid geometry and retains valid saved positions', () => {
  assert.deepEqual(
    normalizeCanvas([
      { i: 'metric-0', x: 99, y: -1, w: 99, h: 0 },
      { i: 'unknown', x: 0, y: 0, w: 3, h: 4 },
    ]),
    [{ i: 'metric-0', x: 0, y: 0, w: 12, h: 3 }],
  );
  const preferences = {
    ...defaultDashboardLayout(),
    canvas: [{ i: 'funnel', x: 4, y: 2, w: 8, h: 10 }],
  };
  assert.deepEqual(canvasLayout(preferences, ['metric-0', 'funnel'])[1], preferences.canvas[0]);
});
