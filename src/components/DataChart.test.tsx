import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Line: () => null,
  Bar: () => null,
  ReferenceLine: () => null,
}));
import DataChart from './DataChart';
describe('chart data alternative', () => {
  it('exposes title series and real values in a table', () => {
    render(
      <DataChart
        title="روند وزن"
        data={[{ label: 'امروز', weight: 80, trend: 79.5 }]}
        series={[
          { key: 'weight', label: 'وزن' },
          { key: 'trend', label: 'میانگین' },
        ]}
      />,
    );
    expect(screen.getByRole('table')).toHaveAccessibleName('روند وزن');
    expect(screen.getByRole('columnheader', { name: 'وزن' })).toBeInTheDocument();
    expect(screen.getByText('79.5')).toBeInTheDocument();
  });
});
