export type MetaAction = { action_type: string; value: string };

// Use only the exact action and its aggregate value; attribution windows overlap.
export function landingPageViews(actions: MetaAction[] = []): number {
  const value = Number(actions.find((a) => a.action_type === 'landing_page_view')?.value ?? 0);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
