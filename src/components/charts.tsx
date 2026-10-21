'use client';
import { useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { money, number } from '@/lib/format';
import type { DashboardData } from '@/lib/types';
export function RevenueChart({ data }: { data: DashboardData['series'] }) {
  const [shown, setShown] = useState({ revenue: true, spend: true });
  return (
    <>
      <div className="chart-legend">
        {(
          [
            ['revenue', 'Faturamento'],
            ['spend', 'Investimento'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={!shown[k] ? 'muted' : ''}
            onClick={() => setShown({ ...shown, [k]: !shown[k] })}
          >
            <i
              style={{
                background: k === 'revenue' ? '#72dfb6' : '#6c82ea',
                opacity: shown[k] ? 1 : 0.3,
              }}
            />
            {label}
          </button>
        ))}
      </div>
      <div className="revenue-chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <AreaChart data={data} margin={{ top: 20, right: 12, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#72dfb6" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#72dfb6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6c82ea" stopOpacity={0.13} />
                <stop offset="100%" stopColor="#6c82ea" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#29303c" strokeDasharray="3 5" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#858e9f', fontSize: 11 }}
              dy={10}
              minTickGap={32}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#858e9f', fontSize: 11 }}
              width={78}
              tickFormatter={(v) =>
                `R$ ${new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v / 100)}`
              }
            />
            <Tooltip
              contentStyle={{
                background: '#202936',
                border: '1px solid #384154',
                borderRadius: 10,
                color: '#edf2f7',
                fontSize: 12,
              }}
              formatter={(v, name) => [
                money(Number(v)),
                name === 'revenue' ? 'Faturamento' : 'Investimento',
              ]}
              labelStyle={{ color: '#aab4c3', marginBottom: 7 }}
            />
            {shown.spend && (
              <Area
                isAnimationActive={false}
                type="monotone"
                dataKey="spend"
                stroke="#7187f5"
                strokeWidth={2}
                fill="url(#spendFill)"
              />
            )}
            {shown.revenue && (
              <Area
                isAnimationActive={false}
                type="monotone"
                dataKey="revenue"
                stroke="#72dfb6"
                strokeWidth={2.5}
                fill="url(#revenueFill)"
                activeDot={{ r: 5, stroke: '#17211f', strokeWidth: 3 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
export function AttributionChart({
  attributed,
  unattributed,
}: {
  attributed: number;
  unattributed: number;
}) {
  const total = attributed + unattributed,
    rate = total ? Math.round((attributed / total) * 100) : 0;
  return (
    <div className="donut-wrap">
      <div className="donut">
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <PieChart>
            <Pie
              isAnimationActive={false}
              data={total ? [{ value: attributed }, { value: unattributed }] : [{ value: 1 }]}
              dataKey="value"
              innerRadius={67}
              outerRadius={82}
              startAngle={90}
              endAngle={-270}
              stroke="none"
              cornerRadius={4}
              paddingAngle={total ? 3 : 0}
            >
              {(total ? ['#72dfb6', '#343e50'] : ['#343e50']).map((c) => (
                <Cell key={c} fill={c} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-label">
          <strong>{rate}%</strong>
          <span>das vendas atribuídas</span>
        </div>
      </div>
    </div>
  );
}
