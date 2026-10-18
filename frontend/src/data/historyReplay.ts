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

export const FACADE_RATINGS = ['SAFE', 'SWARMP', 'UNSAFE'] as const;
export type FacadeRating = typeof FACADE_RATINGS[number];
export interface FacadeObservation { date: string; rating: FacadeRating | null; ambiguous: boolean }

export function filingRating(record: RecordEvent): FacadeRating | null {
  if (record.type.toLowerCase() !== 'fisp filing') return null;
  // Older exports have only "Cycle 8: UNSAFE". Match that exact format, not arbitrary prose.
  const value = record.status?.trim().toUpperCase() ??
    /^(?:Cycle [\d?]+:\s*)?(SAFE|SWARMP|UNSAFE)$/i.exec(record.description.trim())?.[1]?.toUpperCase();
  return FACADE_RATINGS.includes(value as FacadeRating) ? value as FacadeRating : null;
}

/** Missing ratings and conflicting same-day filings are gaps, never invented improvements. */
export function facadeHistory(records: RecordEvent[], cutoff: string): FacadeObservation[] {
  const groups = new Map<string, Set<FacadeRating | null>>();
  for (const record of historyAt(records, [], cutoff).records) {
    if (record.type.toLowerCase() !== 'fisp filing') continue;
    const date = recordDate(record.date)!;
    const ratings = groups.get(date) ?? new Set<FacadeRating | null>();
    ratings.add(filingRating(record));
    groups.set(date, ratings);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, ratings]) => ({
    date, rating: ratings.size === 1 ? [...ratings][0] : null, ambiguous: ratings.size > 1,
  }));
}

export function facadeChange(observations: FacadeObservation[]) {
  const latest = observations.at(-1), previous = observations.at(-2);
  if (!latest?.rating) {
    const known = observations.filter((p) => p.rating).at(-1);
    return { direction: 'unknown', rating: latest?.ambiguous ? null : known?.rating ?? null,
      headline: known && !latest?.ambiguous ? `Last rated filing: ${known.rating}` : 'Condition change unknown',
      detail: latest?.ambiguous ? 'Conflicting same-day ratings. Check the official filings.' : known
        ? `${known.date}. A later record has no comparable rating; subsequent condition change is unknown.`
        : 'No comparable dated façade rating at this point.' };
  }
  if (!previous?.rating) return { direction: 'unknown', rating: latest.rating, headline: `Latest recorded rating: ${latest.rating}`,
    detail: 'Two comparable consecutive filings are needed to describe a change.' };
  const delta = FACADE_RATINGS.indexOf(latest.rating) - FACADE_RATINGS.indexOf(previous.rating);
  return { direction: delta > 0 ? 'worse' : delta < 0 ? 'better' : 'same', rating: latest.rating,
    headline: delta > 0 ? 'Last rating change: worse' : delta < 0 ? 'Last rating change: better' : 'Last rating change: unchanged',
    detail: `${previous.rating} (${previous.date}) → ${latest.rating} (${latest.date})` };
}
