'use client';

import { useId } from 'react';
import { number, percent } from '@/lib/format';

type FunnelProps = { clicks: number; pageviews: number; checkouts: number; sales: number };

export function ConversionFunnel({ clicks, pageviews, checkouts, sales }: FunnelProps) {
  const gradientId = `conversion-flow-${useId().replace(/:/g, '')}`;
  const stages = [
    { label: 'Cliques', value: clicks },
    { label: 'Vis. de página', value: pageviews },
    { label: 'Checkouts', value: checkouts },
    { label: 'Vendas aprov.', value: sales },
  ].map((stage) => ({
    ...stage,
    rate: clicks > 0 ? (stage.value / clicks) * 100 : null,
    // Events are aggregated: a later stage can exceed clicks. Keep its real percentage,
    // while bounding the drawing to the chart so it cannot overflow the card.
    radius: clicks > 0 ? Math.min(1, Math.max(0, stage.value / clicks)) * 78 : 0,
  }));
  const center = 90;
  const top = stages.map((stage) => center - stage.radius);
  const bottom = stages.map((stage) => center + stage.radius);
  let path = `M 0 ${top[0]} L 100 ${top[0]}`;
  for (let i = 1; i < stages.length; i++) {
    const x = 100 + i * 200;
    path += ` C ${x - 100} ${top[i - 1]}, ${x - 100} ${top[i]}, ${x} ${top[i]}`;
  }
  path += ` L 800 ${top[3]} L 800 ${bottom[3]} L 700 ${bottom[3]}`;
  for (let i = 2; i >= 0; i--) {
    const x = 100 + i * 200;
    path += ` C ${x + 100} ${bottom[i + 1]}, ${x + 100} ${bottom[i]}, ${x} ${bottom[i]}`;
  }
  path += ` L 0 ${bottom[0]} Z`;

  return (
    <div className="conversion-funnel">
      <div className="conversion-funnel-plot" aria-hidden="true">
        <svg viewBox="0 0 800 180" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#1262ec" />
              <stop offset="36%" stopColor="#3f55df" />
              <stop offset="70%" stopColor="#8051d4" />
              <stop offset="100%" stopColor="#bf4bba" />
            </linearGradient>
          </defs>
          <line x1="0" x2="800" y1="90" y2="90" stroke="#8655bf" strokeWidth="1" />
          <path d={path} fill={`url(#${gradientId})`} />
        </svg>
      </div>
      <ol className="conversion-funnel-stages" aria-label="Etapas do funil de conversão">
        {stages.map((stage) => (
          <li key={stage.label}>
            <span className="conversion-funnel-label">{stage.label}</span>
            <strong className="conversion-funnel-rate">
              {stage.rate === null ? '—' : percent(stage.rate)}
            </strong>
            <span className="conversion-funnel-count">{number(stage.value)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
