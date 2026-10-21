import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateRange } from '../../src/lib/format';

test('sync range includes today in Sao Paulo across the UTC date boundary', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T01:00:00Z') });
  assert.deepEqual(dateRange(1), { start: '2026-10-21', end: '2026-10-21' });
  const range = dateRange(90);
  assert.equal(range.end, '2026-10-21');
  assert.equal((Date.parse(range.end) - Date.parse(range.start)) / 86400000, 89);
});
