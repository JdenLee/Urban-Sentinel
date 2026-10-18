import { describe, expect, it } from 'vitest';
import { historyAt, historyCounts, historyDates, recordDate } from './historyReplay';
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
