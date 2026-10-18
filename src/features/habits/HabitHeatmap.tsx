import { useMemo, useState } from 'react';
import { CalendarDays, Grid2X2 } from 'lucide-react';
import type { Habit, HabitLog, Settings } from '../../db/types';
import { Card, EmptyState, Field } from '../../components/ui';
import { formatDate, shortDate, weekday } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { buildHeatmap } from './history';
import type { HeatmapCell } from './history';
import { compareHabits } from './model';

interface Props {
  habits: Habit[];
  logs: HabitLog[];
  date: string;
  settings: Settings;
}

export default function HabitHeatmap({ habits, logs, date, settings }: Props) {
  const [filter, setFilter] = useState('all');
  const [previewDate, setPreviewDate] = useState(date);
  const selectedFilter =
    filter === 'all' || habits.some((habit) => habit.id === filter) ? filter : 'all';
  const cells = useMemo(
    () => buildHeatmap(habits, logs, date, selectedFilter === 'all' ? undefined : selectedFilter),
    [habits, logs, date, selectedFilter],
  );
  const preview = cells.find((cell) => cell.date === previewDate) ?? cells[cells.length - 1];
  const leading = (weekday(cells[0].date) - settings.weekStartsOn + 7) % 7;
  const describe = (cell: HeatmapCell) =>
    `${formatDate(cell.date, settings)}، ${formatNumber(cell.done, settings)} از ${formatNumber(cell.total, settings)} عادت${cell.total ? `، ${formatNumber(cell.percent, settings)} درصد انجام‌شده` : '، بدون برنامه'}`;

  return (
    <section className="stack" aria-labelledby="habits-history-heading">
      <div className="habit-section-heading">
        <div>
          <h2 id="habits-history-heading">ردِ قدم‌های شما</h2>
          <p className="muted small">{formatNumber(12, settings)} هفتهٔ منتهی به روز انتخاب‌شده</p>
        </div>
        {habits.length > 0 && (
          <Field label="نمایش نقشه برای" className="habit-map-filter">
            <select value={selectedFilter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">همهٔ عادت‌ها</option>
              {[...habits].sort(compareHabits).map((habit) => (
                <option key={habit.id} value={habit.id}>
                  {habit.name}
                  {habit.archived ? ' (بایگانی‌شده)' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Card>
        {!habits.length ? (
          <EmptyState
            icon={Grid2X2}
            title="نقشه با اولین عادت شما شروع می‌شود"
            description="پس از ساخت عادت و ثبت مقدار، روند انجام آن را اینجا می‌بینید."
          />
        ) : (
          <div className="stack">
            <div className="row justify-between muted small">
              <span>{shortDate(cells[0].date, settings)}</span>
              <span>{shortDate(date, settings)}</span>
            </div>
            <div className="habit-heatmap-grid" role="group" aria-label="نقشهٔ انجام عادت‌ها">
              {Array.from({ length: leading }, (_, index) => (
                <span key={`space-${index}`} className="habit-heatmap-spacer" aria-hidden="true" />
              ))}
              {cells.map((cell) => (
                <button
                  key={cell.date}
                  type="button"
                  className={`habit-heat-cell ${!cell.total ? 'habit-heat-none' : !cell.done ? 'habit-heat-zero' : cell.percent < 100 ? 'habit-heat-partial' : 'habit-heat-full'}`}
                  aria-label={describe(cell)}
                  aria-pressed={preview.date === cell.date}
                  title={describe(cell)}
                  onClick={() => setPreviewDate(cell.date)}
                  onFocus={() => setPreviewDate(cell.date)}
                  onMouseEnter={() => setPreviewDate(cell.date)}
                >
                  <span aria-hidden="true">
                    {formatDate(cell.date, settings, { day: 'numeric' })}
                  </span>
                  <span className="habit-heat-mark" aria-hidden="true">
                    {cell.total
                      ? `${formatNumber(cell.done, settings)}/${formatNumber(cell.total, settings)}`
                      : 'بدون برنامه'}
                  </span>
                </button>
              ))}
            </div>
            <div className="habit-map-legend" aria-label="راهنمای نقشه">
              <span>
                <i className="habit-heat-none" aria-hidden="true" />
                بدون برنامه
              </span>
              <span>
                <i className="habit-heat-zero" aria-hidden="true" />
                انجام‌نشده
              </span>
              <span>
                <i className="habit-heat-partial" aria-hidden="true" />
                بخشی انجام‌شده
              </span>
              <span>
                <i className="habit-heat-full" aria-hidden="true" />
                کامل
              </span>
            </div>
            <div
              className="habit-map-readout row"
              role="status"
              aria-label="جزئیات روز نقشه"
              aria-live="polite"
              aria-atomic="true"
            >
              <CalendarDays size={20} aria-hidden="true" />
              <div>
                <p className="font-semibold">{formatDate(preview.date, settings)}</p>
                <p className="muted small">
                  {formatNumber(preview.done, settings)} از {formatNumber(preview.total, settings)}{' '}
                  عادت
                  {preview.total
                    ? `، ${formatNumber(preview.percent, settings)} درصد انجام‌شده`
                    : '، بدون برنامه'}
                </p>
              </div>
            </div>
            <details>
              <summary>نمایش جدول روزها</summary>
              <div className="chart-table">
                <table>
                  <caption className="sr-only">جدول انجام عادت‌ها در دوازده هفته</caption>
                  <thead>
                    <tr>
                      <th scope="col">تاریخ</th>
                      <th scope="col">انجام‌شده</th>
                      <th scope="col">برنامه‌ریزی‌شده</th>
                      <th scope="col">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...cells].reverse().map((cell) => (
                      <tr key={cell.date}>
                        <th scope="row">{formatDate(cell.date, settings)}</th>
                        <td>{formatNumber(cell.done, settings)}</td>
                        <td>{formatNumber(cell.total, settings)}</td>
                        <td>
                          {cell.total
                            ? `${formatNumber(cell.percent, settings)} درصد`
                            : 'بدون برنامه'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </Card>
    </section>
  );
}
