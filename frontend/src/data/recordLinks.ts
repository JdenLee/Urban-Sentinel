/**
 * Links from a building or filing to the official public records it came from.
 *
 * - NYC DOB BIS: the building's façade filings and property profile, addressable by BIN. BIS lists FISP
 *   cycles up to 2016 in full and later cycles by control number; DOB NOW holds newer reports.
 * - NYC Open Data: the exact filing row(s) in "DOB NOW: Safety – Facades Compliance Filings" (xubg-57si),
 *   the dataset the model is trained on. Filtered by TR6 report number when known, else by BIN + cycle.
 *
 * Every value is validated before it goes into a URL, so malformed data yields no link rather than a broken one.
 */
const BIN_RE = /^[1-5]\d{6}$/;
const TR6_RE = /^TR6-[A-Z0-9]+(?:-[A-Z0-9]+)*$/i;
const FACADES_DATASET =
  'https://data.cityofnewyork.us/Housing-Development/DOB-NOW-Safety-Facades-Compliance-Filings/xubg-57si';

export const DOB_NOW_PORTAL_URL = 'https://a810-dobnow.nyc.gov/publish/Index.html#!/';

const validBin = (bin: string | null | undefined): bin is string => typeof bin === 'string' && BIN_RE.test(bin);

export function dobBisFacadesUrl(bin: string | null | undefined): string | null {
  return validBin(bin) ? `https://a810-bisweb.nyc.gov/bisweb/FacadesByLocationServlet?requestid=0&allbin=${bin}` : null;
}

export function dobBisProfileUrl(bin: string | null | undefined): string | null {
  return validBin(bin) ? `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${bin}` : null;
}

function openDataQuery(where: string): string {
  return `${FACADES_DATASET}/explore/query/${encodeURIComponent(`SELECT * WHERE ${where}`)}/page/filter`;
}

/** The filing's row(s) on NYC Open Data: by TR6 report number if available, otherwise every filing of that cycle. */
export function openDataFilingUrl(opts: { bin: string | null | undefined; cycle?: number | null; reference?: string | null }): string | null {
  if (opts.reference && TR6_RE.test(opts.reference)) return openDataQuery(`\`tr6_no\` = '${opts.reference.toUpperCase()}'`);
  if (!validBin(opts.bin)) return null;
  if (opts.cycle !== undefined && opts.cycle !== null && Number.isInteger(opts.cycle) && opts.cycle > 0) {
    return openDataQuery(`\`bin\` = '${opts.bin}' AND \`cycle\` = '${opts.cycle}'`);
  }
  return openDataQuery(`\`bin\` = '${opts.bin}'`);
}

/** Pull the cycle number out of descriptions such as "Cycle 9: SWARMP" when no structured field exists. */
export function cycleFromDescription(description: string): number | null {
  const m = /\bCycle\s+(\d{1,2})\b/i.exec(description);
  return m ? Number(m[1]) : null;
}
