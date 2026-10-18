import { describe, expect, it } from 'vitest';
import { facadeChange, facadeHistory, filingRating, historyAt, historyCounts, historyDates, recordDate } from './historyReplay';
import type { MovementPoint, RecordEvent } from '../types/predictions';
const records: RecordEvent[] = [
  { date: '2024-01-01', type: 'FISP filing', description: 'UNSAFE' },
  { date: '2018-06-15', type: 'FISP filing', description: 'SAFE' },
  { date: null, type: 'Complaint', description: 'No date provided' },
  { date: '2020-02-30', type: 'Complaint', description: 'Invalid date' },
];
const points: MovementPoint[] = [
  { date: '2019-01-01', displacement_mm: -2.5, baseline_mm: null },
  { date: '2018-06-15', displacement_mm: 0, baseline_mm: null },
];
describe('recorded history replay', () => {
  it('counts only dated records, including multiple events on the same day', () => {
    expect(historyCounts([...records, records[1]], historyDates(records, points))).toEqual([2, 2, 3]);
    expect(historyAt(records, points, 'invalid')).toEqual({ records: [], points: [] });
  });
  it('accepts real calendar dates, not invalid dates or guessed years', () => {
    expect(recordDate('2020-02-29')).toBe('2020-02-29');
    for (const date of [null, '', 'unknown', '2018', '2020-02-30', '2020-13-01']) expect(recordDate(date)).toBeNull();
  });
  it('unions observed dates in chronological order without duplicating steps', () => {
    expect(historyDates(records, points)).toEqual(['2018-06-15', '2019-01-01', '2024-01-01']);
  });
  it('never reveals a later filing or satellite measurement at an earlier step', () => {
    const at = historyAt(records, points, '2018-06-15');
    expect(at.records.map((r) => r.description)).toEqual(['SAFE']);
    expect(at.points.map((p) => p.displacement_mm)).toEqual([0]);
  });
  it('handles absent records, one observation and times before coverage', () => {
    expect(historyDates([], [])).toEqual([]);
    expect(historyDates([], [points[0]])).toEqual(['2019-01-01']);
    expect(historyAt(records, points, '2010-01-01')).toEqual({ records: [], points: [] });
  });
  it('does not mutate input arrays or extrapolate the latest satellite reading', () => {
    const before = JSON.stringify({ records, points });
    const at = historyAt(records, points, '2024-01-01');
    expect(at.points.at(-1)?.date).toBe('2019-01-01');
    expect(JSON.stringify({ records, points })).toBe(before);
  });
});

describe('interpretable filing condition history', () => {
  const filing = (date: string, status: string): RecordEvent => ({ date, status, type: 'FISP filing', description: `Cycle 8: ${status}` });
  it('describes worse, better and unchanged only between comparable consecutive ratings', () => {
    const describe = (statuses: string[]) => facadeChange(facadeHistory(statuses.map((s, i) => filing(`202${i}-01-01`, s)), '2025-01-01'));
    expect(describe(['SAFE', 'SWARMP', 'UNSAFE']).direction).toBe('worse');
    expect(describe(['UNSAFE', 'SAFE']).direction).toBe('better');
    expect(describe(['SAFE', 'SAFE']).direction).toBe('same');
    expect(describe(['SAFE']).direction).toBe('unknown');
    expect(describe(['SAFE', 'No Report Filed']).direction).toBe('unknown');
    expect(describe(['SAFE', 'No Report Filed', 'UNSAFE']).direction).toBe('unknown');
  });
  it('does not infer façade condition from complaint prose or an unknown explicit rating', () => {
    expect(filingRating({ ...filing('2020-01-01', 'UNSAFE'), type: 'Complaint' })).toBeNull();
    expect(filingRating({ date: '2020-01-01', type: 'FISP filing', description: 'Not UNSAFE' })).toBeNull();
    expect(filingRating({ ...filing('2020-01-01', 'UNKNOWN'), description: 'SAFE' })).toBeNull();
    expect(filingRating({ date: '2020-01-01', type: 'FISP filing', description: 'Cycle 8: UNSAFE' })).toBe('UNSAFE');
  });
  it('excludes future filings, invalid dates and unknown-date records', () => {
    const data = [...records, filing('2030-01-01', 'SAFE')];
    const result = facadeHistory(data, '2020-01-01');
    expect(result).toEqual([{ date: '2018-06-15', rating: 'SAFE', ambiguous: false }]);
  });
  it('marks same-day conflicting ratings unknown instead of guessing filing order', () => {
    const data = [filing('2020-01-01', 'SAFE'), filing('2020-01-01', 'UNSAFE')];
    expect(facadeHistory(data, '2021-01-01')[0]).toEqual({ date: '2020-01-01', rating: null, ambiguous: true });
    expect(facadeChange(facadeHistory(data, '2021-01-01')).direction).toBe('unknown');
  });
  it('keeps the last actual rating readable when a later cycle has no report', () => {
    const data = [filing('2020-01-15', 'UNSAFE'), filing('2022-02-21', 'No Report Filed')];
    const result = facadeChange(facadeHistory(data, '2026-01-01'));
    expect(result.direction).toBe('unknown');
    expect(result.headline).toBe('Last rated filing: UNSAFE');
    expect(result.detail).toContain('2020-01-15');
    expect(result.detail).toContain('unknown');
  });
});
