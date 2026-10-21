export const layoutSections = [
  { id: 'metrics', label: 'Indicadores principais', width: 'full' },
  { id: 'financials', label: 'Financeiro Cakto', width: 'full' },
  { id: 'secondary', label: 'Vendas, CPA e reembolsos', width: 'full' },
  { id: 'performance', label: 'Desempenho de vendas', width: 'wide' },
  { id: 'attribution', label: 'Atribuição de vendas', width: 'narrow' },
  { id: 'campaigns', label: 'Tabela de campanhas', width: 'full' },
  { id: 'funnel', label: 'Funil de conversão', width: 'wide' },
  { id: 'connections', label: 'Saúde das integrações', width: 'narrow' },
] as const;
export type SectionId = (typeof layoutSections)[number]['id'];
export type SectionWidth = 'full' | 'wide' | 'half' | 'narrow';
export type DashboardLayoutPreferences = {
  version: 1;
  density: 'comfortable' | 'compact';
  columns: 2 | 3 | 4;
  textSize: 'normal' | 'large';
  canvas?: CanvasItem[];
  sections: { id: SectionId; visible: boolean; width: SectionWidth }[];
};
export function defaultDashboardLayout(): DashboardLayoutPreferences {
  return {
    version: 1,
    density: 'comfortable',
    columns: 4,
    textSize: 'normal',
    sections: layoutSections.map(({ id, width }) => ({ id, visible: true, width })),
  };
}
export function normalizeDashboardLayout(value: unknown): DashboardLayoutPreferences {
  const defaults = defaultDashboardLayout();
  if (!value || typeof value !== 'object') return defaults;
  const input = value as Record<string, unknown>;
  if (input.version !== 1) return defaults;
  const sections: DashboardLayoutPreferences['sections'] = [];
  if (Array.isArray(input.sections))
    for (const candidate of input.sections) {
      if (!candidate || typeof candidate !== 'object') continue;
      const def = layoutSections.find((s) => s.id === candidate.id);
      if (!def || sections.some((s) => s.id === def.id)) continue;
      sections.push({
        id: def.id,
        visible: typeof candidate.visible === 'boolean' ? candidate.visible : true,
        width: ['full', 'wide', 'half', 'narrow'].includes(candidate.width)
          ? candidate.width
          : def.width,
      });
    }
  for (const def of defaults.sections)
    if (!sections.some((s) => s.id === def.id)) sections.push(def);
  if (!sections.some((s) => s.visible)) sections[0].visible = true;
  return {
    ...defaults,
    sections,
    ...(Array.isArray(input.canvas) ? { canvas: normalizeCanvas(input.canvas) } : {}),
    density: input.density === 'compact' ? 'compact' : 'comfortable',
    columns: input.columns === 2 || input.columns === 3 ? input.columns : 4,
    textSize: input.textSize === 'large' ? 'large' : 'normal',
  };
}

export type CanvasItem = { i: string; x: number; y: number; w: number; h: number };
export const primaryCardIds = ['metric-0', 'metric-1', 'metric-2', 'metric-3'];
export const financialCardIds = Array.from({ length: 11 }, (_, index) => `financial-${index}`);
export const canvasIds: string[] = [
  ...primaryCardIds,
  ...financialCardIds,
  'financial-intro',
  'financial-details',
  ...layoutSections.filter((s) => s.id !== 'metrics').map((s) => s.id),
];
export function normalizeCanvas(value: unknown): CanvasItem[] {
  if (!Array.isArray(value)) return [];
  const items: CanvasItem[] = [];
  for (const v of value) {
    if (!v || !canvasIds.includes(v.i) || items.some((item) => item.i === v.i)) continue;
    if (!['x', 'y', 'w', 'h'].every((key) => Number.isFinite(v[key]))) continue;
    const w = Math.max(2, Math.min(12, Math.round(v.w)));
    items.push({
      i: v.i,
      w,
      h: Math.max(3, Math.min(80, Math.round(v.h))),
      x: Math.max(0, Math.min(12 - w, Math.round(v.x))),
      y: Math.max(0, Math.min(1000, Math.round(v.y))),
    });
  }
  return items;
}
export function canvasLayout(preferences: DashboardLayoutPreferences, ids: string[]): CanvasItem[] {
  const saved = normalizeCanvas(preferences.canvas);
  const result: CanvasItem[] = [];
  let y = 0,
    x = 0,
    rowHeight = 0;
  for (const id of ids) {
    const section = preferences.sections.find((s) => s.id === id);
    const width = section?.width || 'full';
    const isCard = primaryCardIds.includes(id) || financialCardIds.includes(id);
    const w = isCard ? 12 / preferences.columns : { full: 12, wide: 8, half: 6, narrow: 4 }[width];
    const h = isCard
      ? primaryCardIds.includes(id)
        ? 5
        : 6
      : {
          'financial-intro': 3,
          'financial-details': 13,
          financials: 26,
          secondary: 4,
          performance: 12,
          attribution: 12,
          campaigns: 13,
          funnel: 11,
          connections: 11,
        }[id] || 10;
    if (x + w > 12) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    const item = saved.find((item) => item.i === id);
    result.push(item || { i: id, x, y, w, h });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return result;
}
