import { dateRange } from './format';

export type DashboardFilters = {
  period: string;
  campaign: string;
  range: { start: string; end: string };
};

export function validAnalysisRange(range: DashboardFilters['range']) {
  const validDate = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  return (
    validDate(range?.start) &&
    validDate(range?.end) &&
    range.start <= range.end &&
    Date.parse(range.end) - Date.parse(range.start) <= 89 * 86400000
  );
}

export function restoreDashboardFilters(raw: string | null, demo: boolean): DashboardFilters {
  const defaults = { period: '7', campaign: '', range: dateRange(7) };
  try {
    const saved = JSON.parse(raw || 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    const campaign =
      typeof saved.campaign === 'string' && saved.campaign.length <= 100 ? saved.campaign : '';
    if (['1', '7', '14', '30'].includes(saved.period)) {
      return { period: saved.period, campaign, range: dateRange(Number(saved.period)) };
    }
    if (!demo && saved.period === 'custom' && validAnalysisRange(saved.range)) {
      return {
        period: 'custom',
        campaign,
        range: { start: saved.range.start, end: saved.range.end },
      };
    }
    return { ...defaults, campaign };
  } catch {
    return defaults;
  }
}
