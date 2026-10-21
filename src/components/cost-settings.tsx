'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Check, Loader2, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { defaultCosts, type Costs } from '@/lib/costs';
export function CostSettings({
  demo,
  name,
  onSaved,
  notify,
}: {
  demo: boolean;
  name: string;
  onSaved: (name: string) => void;
  notify: (message: string) => void;
}) {
  const [workspaceName, setWorkspaceName] = useState(name),
    [costs, setCosts] = useState(defaultCosts),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!demo);
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    fetch('/api/settings')
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        if (!cancelled) {
          setCosts(b.costs);
          setWorkspaceName(b.name);
        }
      })
      .catch((e) => {
        if (!cancelled) notify(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [demo]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (demo) {
      notify('Custos disponíveis para sua operação após criar uma conta.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workspaceName, costs }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      onSaved(workspaceName);
      notify('Custos salvos. O lucro estimado será recalculado nos próximos filtros.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const fields: { key: keyof Costs; label: string; rate: boolean }[] = [
    { key: 'salesTaxBps', label: 'Impostos sobre vendas (%)', rate: true },
    { key: 'feeBps', label: 'Taxa média da plataforma (%)', rate: true },
    { key: 'adTaxBps', label: 'Impostos sobre anúncios (%)', rate: true },
    { key: 'productCost', label: 'Custo médio por venda aprovada (R$)', rate: false },
    { key: 'dailyExpenses', label: 'Despesas fixas por dia (R$)', rate: false },
  ];
  return (
    <section className="panel cost-settings">
      <div className="panel-heading">
        <div>
          <h2>
            <Settings2 size={17} />
            Custos e lucro estimado
          </h2>
          <p>
            Defina sua estrutura de custos para calcular um resultado mais próximo da sua operação.
          </p>
        </div>
      </div>
      <form onSubmit={save}>
        <label className="form-label">
          Nome do workspace
          <input
            disabled={loading || busy}
            required
            minLength={2}
            maxLength={100}
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
        </label>
        <div className="cost-fields">
          {fields.map((f) => (
            <label className="form-label" key={f.key}>
              {f.label}
              <input
                type="number"
                disabled={loading || busy}
                required
                min="0"
                max={f.rate ? 100 : 1000000}
                step="0.01"
                value={costs[f.key] / 100}
                onChange={(e) =>
                  setCosts({ ...costs, [f.key]: Math.round(Number(e.target.value) * 100) })
                }
              />
            </label>
          ))}
        </div>
        <div className="info-callout">
          <ShieldCheck size={17} />
          <p>
            São estimativas baseadas nas taxas informadas, aplicadas aos pedidos aprovados. Não
            substituem conciliação contábil ou taxas reais da Cakto. Despesas fixas não são
            distribuídas ao filtrar campanha, conjunto ou anúncio.
          </p>
        </div>
        <Button type="submit" disabled={busy || loading}>
          {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}Salvar custos
        </Button>
      </form>
    </section>
  );
}
