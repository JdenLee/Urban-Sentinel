import { useCallback, useEffect, useState } from 'react';
import type { JoinedFeature } from '../types/predictions';
import { PRIORITY_LABEL } from './priority';
import type { AddressMatch } from './geosearch';

export type AssignmentStatus = 'unassigned' | 'assigned' | 'inspected' | 'deferred';
export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  inspected: 'Inspected',
  deferred: 'Deferred',
};
export const ASSIGNMENT_STATUSES = Object.keys(ASSIGNMENT_LABEL) as AssignmentStatus[];

const STORAGE_KEY = 'facade-ews.assignments.v1';

function readStore(): Record<string, AssignmentStatus> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Per-browser assignment status for scored buildings (a demo stand-in for a work-order system). */
export function useAssignments() {
  const [map, setMap] = useState<Record<string, AssignmentStatus>>(() => readStore());
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* storage unavailable: keep in memory only */
    }
  }, [map]);
  const get = useCallback((bin: string): AssignmentStatus => map[bin] ?? 'unassigned', [map]);
  const set = useCallback((bin: string, status: AssignmentStatus) => {
    setMap((m) => {
      const next = { ...m };
      if (status === 'unassigned') delete next[bin];
      else next[bin] = status;
      return next;
    });
  }, []);
  return { get, set };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of the shortlist, in rank order. BIN is quoted-safe text so spreadsheets keep it as a string. */
export function shortlistCsv(rows: JoinedFeature[], status: (bin: string) => AssignmentStatus): string {
  const header = ['rank', 'bin', 'address', 'priority', 'score', 'probability', 'top_signal', 'status'];
  const lines = rows.map((f) => {
    const p = f.properties.prediction!;
    return [
      p.rank,
      `="${f.properties.bin}"`,
      f.properties.address ?? '',
      PRIORITY_LABEL[p.priority],
      p.score.toFixed(3),
      p.probability === null ? '' : p.probability.toFixed(3),
      p.explanations[0] ?? '',
      ASSIGNMENT_LABEL[status(f.properties.bin)],
    ]
      .map(csvCell)
      .join(',');
  });
  return [header.join(','), ...lines].join('\n') + '\n';
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type SearchItem =
  | { kind: 'scored'; bin: string; label: string; feature: JoinedFeature }
  | { kind: 'address'; bin: string; label: string; match: AddressMatch }
  | { kind: 'bin'; bin: string; label: string };

/**
 * One result list for the search box: scored buildings in the scene first (they carry a priority), then
 * NYC address suggestions for other buildings, then a direct "look up this BIN" entry for a typed BIN.
 */
export function combineSearchResults(
  local: JoinedFeature[],
  addresses: AddressMatch[],
  query: string,
  limit = 10,
): SearchItem[] {
  const items: SearchItem[] = local.map((f) => ({
    kind: 'scored' as const,
    bin: f.properties.bin,
    label: f.properties.address ?? `BIN ${f.properties.bin}`,
    feature: f,
  }));
  const seen = new Set(items.map((i) => i.bin));
  for (const m of addresses) {
    if (seen.has(m.bin)) continue;
    seen.add(m.bin);
    items.push({ kind: 'address', bin: m.bin, label: m.label, match: m });
  }
  const q = query.trim();
  if (/^[1-5]\d{6}$/.test(q) && !/^[1-5]000000$/.test(q) && !seen.has(q)) {
    items.push({ kind: 'bin', bin: q, label: `Look up BIN ${q}` });
  }
  return items.slice(0, limit);
}

/** Case-insensitive match on address words or BIN prefix. */
export function searchScored(features: JoinedFeature[], query: string, limit = 8): JoinedFeature[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const isBin = /^\d{3,7}$/.test(q);
  return features
    .filter((f) =>
      isBin ? f.properties.bin.startsWith(q) : (f.properties.address ?? '').toLowerCase().includes(q),
    )
    .slice(0, limit);
}
