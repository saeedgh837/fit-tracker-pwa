import { useId } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
export interface ChartSeries {
  key: string;
  label: string;
  color?: string;
  dashed?: boolean;
  type?: 'line' | 'bar';
}
interface Props {
  data: Record<string, string | number | null>[];
  xKey?: string;
  series: ChartSeries[];
  goal?: number;
  goalLabel?: string;
  height?: number;
  valueFormatter?: (n: number) => string;
  title: string;
}
export default function DataChart({
  data,
  xKey = 'label',
  series,
  goal,
  goalLabel = 'هدف',
  height = 250,
  valueFormatter = (n) => String(Math.round(n * 100) / 100),
  title,
}: Props) {
  const id = useId().replaceAll(':', '');
  const color = (s: ChartSeries, i: number) => s.color ?? `var(--series-${Math.min(i + 1, 3)})`;
  const dash = (s: ChartSeries, i: number) =>
    s.dashed || i === 1 ? '5 4' : i === 2 ? '2 4' : undefined;
  return (
    <figure aria-label={title} className="min-w-0 m-0">
      <div className="chart-wrap" style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            data={data}
            margin={{ top: 12, right: 12, bottom: 8, left: 0 }}
            accessibilityLayer={false}
          >
            <defs>
              <pattern
                id={`pattern-${id}`}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink)" strokeWidth="1" />
              </pattern>
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey={xKey}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
              tick={{ fill: 'var(--muted)', fontSize: 11, fontFamily: 'Vazirmatn' }}
              dy={8}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={52}
              tick={{ fill: 'var(--muted)', fontSize: 11, fontFamily: 'Vazirmatn' }}
              domain={['auto', 'auto']}
              tickFormatter={(v) => valueFormatter(Number(v)).split(' ')[0]}
            />
            <Tooltip
              cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }}
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                color: 'var(--ink)',
                direction: 'rtl',
                fontFamily: 'Vazirmatn',
                fontSize: 12,
              }}
              labelStyle={{ color: 'var(--ink)', marginBottom: 6 }}
              itemStyle={{ color: 'var(--ink)' }}
              formatter={(value, name) => [
                valueFormatter(Number(value)),
                series.find((s) => s.key === name)?.label ?? String(name),
              ]}
            />
            {goal !== undefined && (
              <ReferenceLine
                y={goal}
                stroke="var(--muted)"
                strokeDasharray="4 4"
                label={{
                  value: goalLabel,
                  fill: 'var(--muted)',
                  fontSize: 11,
                  position: 'insideTopRight',
                }}
              />
            )}
            {series.map((s, i) =>
              s.type === 'bar' ? (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  fill={color(s, i)}
                  maxBarSize={24}
                  radius={[4, 4, 0, 0]}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.key}
                  type="monotone"
                  stroke={color(s, i)}
                  strokeWidth={2}
                  strokeDasharray={dash(s, i)}
                  dot={
                    data.length < 14 ? { r: 4, stroke: 'var(--surface)', strokeWidth: 2 } : false
                  }
                  activeDot={{ r: 6, stroke: 'var(--surface)', strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="flex flex-wrap gap-x-5 gap-y-2 justify-center mt-3 small">
        {series.map((s, i) => (
          <span key={s.key} className="row gap-2">
            <svg width="24" height="10" aria-hidden="true">
              <line
                x1="0"
                y1="5"
                x2="24"
                y2="5"
                stroke={color(s, i)}
                strokeWidth={s.type === 'bar' ? 6 : 2}
                strokeDasharray={s.type === 'bar' ? undefined : dash(s, i)}
              />
            </svg>
            {s.label}
          </span>
        ))}
        {goal !== undefined && (
          <span className="row gap-2">
            <span aria-hidden="true" style={{ width: 18, borderTop: '2px dashed var(--muted)' }} />
            {goalLabel}
          </span>
        )}
      </figcaption>
      <details className="mt-2 small">
        <summary>مشاهدهٔ جدول داده‌ها</summary>
        <div className="chart-table" tabIndex={0} role="region" aria-label={`جدول ${title}`}>
          <table aria-label={title}>
            <thead>
              <tr>
                <th scope="col">تاریخ</th>
                {series.map((s) => (
                  <th scope="col" key={s.key}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{row[xKey]}</th>
                  {series.map((s) => (
                    <td key={s.key}>
                      {typeof row[s.key] === 'number'
                        ? valueFormatter(row[s.key] as number)
                        : 'ثبت نشده'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
