import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landingPageViews } from '../../src/lib/meta-insights';

test('landing views use only the exact Meta action without counting other actions', () => {
  assert.equal(landingPageViews([
    { action_type: 'link_click', value: '12' },
    { action_type: 'landing_page_view', value: '8' },
    { action_type: 'view_content', value: '6' },
  ]), 8);
});
test('absent or invalid landing views stay zero', () => {
  assert.equal(landingPageViews(), 0);
  for (const value of ['NaN', '-1', 'Infinity']) {
    assert.equal(landingPageViews([{ action_type: 'landing_page_view', value }]), 0);
  }
});
