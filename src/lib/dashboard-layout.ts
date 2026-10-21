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
    density: input.density === 'compact' ? 'compact' : 'comfortable',
    columns: input.columns === 2 || input.columns === 3 ? input.columns : 4,
    textSize: input.textSize === 'large' ? 'large' : 'normal',
  };
}
