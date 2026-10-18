import type { MovementPoint, RecordEvent } from '../types/predictions';

/** Date-only records are ordered in UTC; malformed/undated events never acquire an invented date. */
export function recordDate(value: string | null): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(date);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? date : null;
}

export function historyDates(records: RecordEvent[], points: MovementPoint[]): string[] {
  return [...new Set([...records.map((r) => recordDate(r.date)), ...points.map((p) => recordDate(p.date))]
    .filter((d): d is string => d !== null))].sort();
}

export function historyAt(records: RecordEvent[], points: MovementPoint[], date: string) {
  if (!recordDate(date)) return { records: [], points: [] };
  return {
    records: records.filter((r) => { const d = recordDate(r.date); return d !== null && d <= date; })
      .sort((a, b) => b.date!.localeCompare(a.date!)),
    points: points.filter((p) => { const d = recordDate(p.date); return d !== null && d <= date && Number.isFinite(p.displacement_mm); })
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Counts for chronologically sorted observation dates, without sorting every prefix on each frame. */
export function historyCounts(records: RecordEvent[], dates: string[]): number[] {
  const recorded = records.map((r) => recordDate(r.date)).filter((d): d is string => d !== null).sort();
  let count = 0;
  return dates.map((date) => {
    while (count < recorded.length && recorded[count] <= date) count++;
    return count;
  });
}
