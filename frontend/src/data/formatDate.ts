/**
 * Show a date-like value as YYYY-MM-DD. Only ISO-style dates are parsed: `new Date()` also accepts
 * free text such as "FISP cycle 9" (it returned 2001-09-01), so anything else is shown verbatim.
 */
export function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  if (!/^\d{4}-\d{2}-\d{2}/.test(s.trim())) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}
