import { describe, expect, it } from 'vitest';
import type { Polygon, MultiPolygon } from 'geojson';
import { bblFromFootprint, buildingClassLabel, normalizeBbl, parsePluto } from './buildingFacts';
import { AERIAL_SIZE, aerialView, geometryCenter, parseCommonsPhoto, plain, streetViewImageUrl, streetViewUrl } from './buildingImagery';

// 10 Avenue D: an NYCHA lot with 18 buildings, as MapPLUTO returns it.
const PLUTO_ROW = {
  bbl: '1003560001.00000000', address: '10 AVENUE D', numfloors: '14.0000000', unitsres: '1861', unitstotal: '1861',
  bldgclass: 'D3', landuse: '3', bldgarea: '1658649', lotarea: '693945', yearbuilt: '1950', yearalter1: '0',
  yearalter2: '0', ownertype: 'O', zonedist1: 'R7-2', numbldgs: '18',
};

describe('building facts', () => {
  it('normalises BBLs and rejects malformed ones', () => {
    expect(normalizeBbl('1003560001.00000000')).toBe('1003560001');
    expect(normalizeBbl(1003230001)).toBe('1003230001');
    expect(normalizeBbl('6003560001')).toBeNull();
    expect(normalizeBbl('abc')).toBeNull();
    expect(normalizeBbl(null)).toBeNull();
  });

  it('takes the MapPLUTO BBL from the footprint, falling back to the base BBL', () => {
    expect(bblFromFootprint([{ mappluto_bbl: '1003230001', base_bbl: '1003230002' }])).toBe('1003230001');
    expect(bblFromFootprint([{ base_bbl: '1003230002' }])).toBe('1003230002');
    expect(bblFromFootprint([])).toBeNull();
    expect(bblFromFootprint({ error: true })).toBeNull();
  });

  it('parses a lot record and decodes its codes', () => {
    const f = parsePluto([PLUTO_ROW])!;
    expect(f.bbl).toBe('1003560001');
    expect(f.floors).toBe(14);
    expect(f.unitsResidential).toBe(1861);
    expect(f.buildingsOnLot).toBe(18);
    expect(f.buildingClassLabel).toBe('Elevator apartments');
    expect(f.landUse).toBe('Multi-family elevator');
    expect(f.ownership).toBe('Other public (state, federal, authority)');
    expect(f.yearAltered).toBeNull(); // PLUTO writes 0 for "never altered"
    expect(f.historicDistrict).toBeNull();
  });

  it('keeps the latest alteration year and tolerates missing fields', () => {
    const f = parsePluto([{ bbl: '1000470001', yearalter1: '1985', yearalter2: '2004', bldgclass: 'O4' }])!;
    expect(f.yearAltered).toBe(2004);
    expect(f.buildingClassLabel).toBe('Office building');
    expect(f.floors).toBeNull();
    expect(f.unitsResidential).toBeNull();
    expect(parsePluto([])).toBeNull();
    expect(parsePluto([{ bbl: 'x' }])).toBeNull();
    expect(buildingClassLabel(null)).toBeNull();
  });
});

const square: Polygon = {
  type: 'Polygon',
  coordinates: [[[-73.978, 40.717], [-73.977, 40.717], [-73.977, 40.718], [-73.978, 40.718], [-73.978, 40.717]]],
};

function outlinePoints(outline: string): [number, number][] {
  return [...outline.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe('aerial view', () => {
  it('requests a Web Mercator box at the image aspect ratio', () => {
    const v = aerialView(square, 40)!;
    const params = new URL(v.url).searchParams;
    expect(params.get('bboxSR')).toBe('3857');
    expect(params.get('imageSR')).toBe('3857');
    expect(params.get('size')).toBe(`${AERIAL_SIZE.width},${AERIAL_SIZE.height}`);
    const [x0, y0, x1, y1] = params.get('bbox')!.split(',').map(Number);
    expect((x1 - x0) / (y1 - y0)).toBeCloseTo(AERIAL_SIZE.width / AERIAL_SIZE.height, 3);
  });

  it('draws the footprint inside the frame, centred, with north up', () => {
    const v = aerialView(square, 40)!;
    const pts = outlinePoints(v.outline);
    expect(pts).toHaveLength(5);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(v.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(v.height);
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(v.width / 2, 0);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(v.height / 2, 0);
    // The first vertex is the south-west corner, so it sits low and to the left.
    expect(pts[0][0]).toBeLessThan(v.width / 2);
    expect(pts[0][1]).toBeGreaterThan(v.height / 2);
  });

  it('widens the box for taller buildings', () => {
    const width = (h: number) => {
      const [x0, , x1] = new URL(aerialView(square, h)!.url).searchParams.get('bbox')!.split(',').map(Number);
      return x1 - x0;
    };
    expect(width(400)).toBeGreaterThan(width(20));
  });

  it('handles multipolygons and refuses unusable geometry', () => {
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [square.coordinates, square.coordinates] };
    expect(aerialView(multi)!.outline.match(/M/g)).toHaveLength(2);
    expect(aerialView(null)).toBeNull();
    expect(aerialView({ type: 'Point', coordinates: [-73.97, 40.71] })).toBeNull();
    expect(aerialView({ type: 'Polygon', coordinates: [[[NaN, 1], [2, 3]]] })).toBeNull();
  });

  it('centres Street View on the building', () => {
    const c = geometryCenter(square)!;
    expect(c[0]).toBeCloseTo(-73.9776, 3);
    expect(c[1]).toBeCloseTo(40.7174, 3);
    expect(streetViewUrl(c[0], c[1])).toContain('map_action=pano&viewpoint=40.717');
    expect(streetViewUrl(999, 0)).toBeNull();
    expect(geometryCenter(null)).toBeNull();
  });
});

describe('Commons photo', () => {
  const response = {
    query: {
      pages: {
        '1': {
          imageinfo: [
            {
              thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/960px-X.jpg',
              url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
              extmetadata: {
                Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:A">Babcock &amp; Wilcox</a>' },
                LicenseShortName: { value: 'CC BY-SA 4.0' },
              },
            },
          ],
        },
      },
    },
  };

  it('returns the thumbnail with plain-text credit', () => {
    expect(parseCommonsPhoto(response)).toEqual({
      src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/960px-X.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:X.jpg',
      artist: 'Babcock & Wilcox',
      license: 'CC BY-SA 4.0',
    });
  });

  it('rejects images served from anywhere but Wikimedia', () => {
    const bad = structuredClone(response);
    bad.query.pages['1'].imageinfo[0].thumburl = 'https://evil.example/x.jpg';
    expect(parseCommonsPhoto(bad)).toBeNull();
    expect(parseCommonsPhoto({})).toBeNull();
  });

  it('strips markup and decodes entities', () => {
    expect(plain('<span>Jean&#39;s &lt;photo&gt;&#x21;</span>')).toBe("Jean's <photo>!");
    expect(plain('')).toBeNull();
    expect(plain(42)).toBeNull();
  });
});

describe('Street View image', () => {
  it('needs a key and a valid location', () => {
    expect(streetViewImageUrl(-73.9776, 40.7174, 30, undefined)).toBeNull();
    expect(streetViewImageUrl(-73.9776, 40.7174, 30, '')).toBeNull();
    expect(streetViewImageUrl(999, 40.7, 30, 'k')).toBeNull();
  });

  it('asks for the nearest outdoor panorama facing the building, and a 404 when there is none', () => {
    const p = new URL(streetViewImageUrl(-73.9776, 40.7174, 30, 'test-key')!).searchParams;
    expect(p.get('location')).toBe('40.717400,-73.977600');
    expect(p.get('heading')).toBeNull(); // Google then aims from the panorama at the location
    expect(p.get('source')).toBe('outdoor');
    expect(p.get('return_error_code')).toBe('true');
    expect(p.get('key')).toBe('test-key');
  });

  it('tilts up for taller buildings, within limits', () => {
    const pitch = (h: number) => Number(new URL(streetViewImageUrl(-73.97, 40.71, h, 'k')!).searchParams.get('pitch'));
    expect(pitch(10)).toBeLessThan(pitch(120));
    expect(pitch(500)).toBe(28);
    expect(pitch(-5)).toBe(6);
  });
});
