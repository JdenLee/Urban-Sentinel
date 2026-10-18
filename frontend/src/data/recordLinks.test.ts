import { describe, expect, it } from 'vitest';
import { cycleFromDescription, dobBisFacadesUrl, dobBisProfileUrl, openDataFilingUrl } from './recordLinks';

describe('recordLinks', () => {
  it('builds DOB BIS links only for valid BINs', () => {
    expect(dobBisFacadesUrl('1000005')).toBe('https://a810-bisweb.nyc.gov/bisweb/FacadesByLocationServlet?requestid=0&allbin=1000005');
    expect(dobBisProfileUrl('1000005')).toBe('https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=1000005');
    expect(dobBisFacadesUrl('100005')).toBeNull();
    expect(dobBisProfileUrl("1000005' OR 1=1")).toBeNull();
  });

  it('links a filing by TR6 number when known, else by BIN and cycle', () => {
    const byTr6 = openDataFilingUrl({ bin: '1000005', cycle: 9, reference: 'TR6-900003-9A-I2' });
    expect(decodeURIComponent(byTr6!)).toContain("SELECT * WHERE `tr6_no` = 'TR6-900003-9A-I2'");
    const byCycle = openDataFilingUrl({ bin: '1000005', cycle: 9 });
    expect(decodeURIComponent(byCycle!)).toContain("`bin` = '1000005' AND `cycle` = '9'");
    expect(byCycle).toMatch(/^https:\/\/data\.cityofnewyork\.us\/.+\/xubg-57si\/explore\/query\/.+\/page\/filter$/);
  });

  it('never puts unvalidated values into the query', () => {
    const bad = openDataFilingUrl({ bin: '1000005', cycle: 9, reference: "TR6-1' OR '1'='1" });
    expect(decodeURIComponent(bad!)).not.toContain("OR '1'");
    expect(openDataFilingUrl({ bin: 'abc', cycle: 9 })).toBeNull();
  });

  it('reads the cycle from "Cycle 9: SWARMP" descriptions', () => {
    expect(cycleFromDescription('Cycle 9: SWARMP')).toBe(9);
    expect(cycleFromDescription('Cycle 10 initial: UNSAFE · inspected 2025-05-01')).toBe(10);
    expect(cycleFromDescription('DOB violation')).toBeNull();
  });
});
