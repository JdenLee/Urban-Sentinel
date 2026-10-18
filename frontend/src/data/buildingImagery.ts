/**
 * Real imagery of the selected building, from public services that need no key:
 *
 * - Aerial: New York State's statewide orthoimagery (NYS ITS Geospatial Services, 2022–2025, about
 *   30 cm per pixel), cut to a box around the building's own footprint, which is drawn over it.
 * - Street level: a Google Maps Street View link at the building (Maps URLs need no key), and for the
 *   named landmarks a curated Wikimedia Commons photo, credited with its author and licence.
 */
import type { Geometry, Position } from 'geojson';
import { AERIAL_EXPORT_URL, COMMONS_API_URL } from '../config';

const R = 6378137; // Web Mercator sphere radius, metres
const MIN_PAD_M = 30;

export const AERIAL_SIZE = { width: 720, height: 400 } as const;

export interface AerialView {
  url: string;
  /** SVG path of the footprint in image pixels (viewBox 0 0 width height), even-odd fill. */
  outline: string;
  width: number;
  height: number;
}

function mercator([lon, lat]: Position): [number, number] {
  const clamped = Math.max(-85, Math.min(85, lat));
  return [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))];
}

function rings(geometry: Geometry | null | undefined): Position[][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

const valid = (p: Position) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/**
 * The export request and footprint overlay for a building, or null without usable geometry.
 *
 * The box is padded by the footprint's size and by the building's height, because a tall building
 * leans away from the camera in an orthophoto and its roof lands beside its footprint. Padding is in
 * Mercator units (ground metres / cos latitude), which is what keeps it constant on the ground.
 */
export function aerialView(geometry: Geometry | null | undefined, heightM = 0, size = AERIAL_SIZE): AerialView | null {
  const pts = rings(geometry).map((ring) => ring.filter(valid));
  const all = pts.flat();
  if (all.length < 3) return null;
  const projected = pts.map((ring) => ring.map(mercator));
  const xs = projected.flat().map((p) => p[0]);
  const ys = projected.flat().map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const lat = all.reduce((s, p) => s + p[1], 0) / all.length;
  const scale = 1 / Math.cos((lat * Math.PI) / 180);
  const extent = Math.max(maxX - minX, maxY - minY);
  const pad = Math.max(MIN_PAD_M * scale, extent * 0.45, Math.max(0, heightM) * 0.5 * scale);

  const aspect = size.width / size.height;
  const halfW = Math.max((maxX - minX) / 2 + pad, ((maxY - minY) / 2 + pad) * aspect);
  const halfH = halfW / aspect;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const box = [cx - halfW, cy - halfH, cx + halfW, cy + halfH].map((v) => Math.round(v * 10) / 10);

  const px = ([x, y]: [number, number]) =>
    `${(((x - box[0]) / (box[2] - box[0])) * size.width).toFixed(1)},${(((box[3] - y) / (box[3] - box[1])) * size.height).toFixed(1)}`;
  const outline = projected
    .filter((ring) => ring.length >= 3)
    .map((ring) => `M${ring.map(px).join('L')}Z`)
    .join('');

  const params = new URLSearchParams({
    bbox: box.join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: `${size.width},${size.height}`,
    format: 'jpg',
    f: 'image',
  });
  return { url: `${AERIAL_EXPORT_URL}?${params}`, outline, width: size.width, height: size.height };
}

/** Mean of the outer rings' vertices as [lon, lat]; close enough to the middle of a building for a viewpoint. */
export function geometryCenter(geometry: Geometry | null | undefined): [number, number] | null {
  const outer = geometry?.type === 'Polygon' ? [geometry.coordinates[0]] : geometry?.type === 'MultiPolygon' ? geometry.coordinates.map((p) => p[0]) : [];
  const pts = outer.flatMap((ring) => (ring ?? []).filter(valid));
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** Google Maps Street View at the panorama nearest the building (Maps URLs: no key, opens in a new tab). */
export function streetViewUrl(lon: number, lat: number): string | null {
  if (!valid([lon, lat])) return null;
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/**
 * Street View Static image of the building, or null without a key.
 *
 * With a location and no heading, Google points the camera from the nearest outdoor panorama towards
 * that location, so the building is in frame. Taller buildings get the camera tilted up. With
 * return_error_code, a spot with no imagery answers 404 instead of a grey placeholder, so the slide
 * can drop out. The key is a browser key restricted by HTTP referrer; it is never committed.
 */
export function streetViewImageUrl(lon: number, lat: number, heightM: number, key: string | undefined): string | null {
  if (!key || !valid([lon, lat])) return null;
  const pitch = Math.round(Math.min(28, 6 + Math.max(0, heightM) * 0.12));
  const params = new URLSearchParams({
    size: '640x356',
    scale: '2',
    location: `${lat.toFixed(6)},${lon.toFixed(6)}`,
    radius: '60',
    source: 'outdoor',
    fov: '80',
    pitch: String(pitch),
    return_error_code: 'true',
    key,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params}`;
}

export interface CommonsPhoto {
  src: string;
  /** Commons file page: the licence and full credit live there. */
  page: string;
  artist: string | null;
  license: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Commons returns the artist as HTML; keep the text only (rendered as text, never as markup). */
export function plain(html: unknown): string | null {
  if (typeof html !== 'string') return null;
  const s = html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
}

export function parseCommonsPhoto(raw: unknown): CommonsPhoto | null {
  const pages = (raw as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages) return null;
  for (const page of Object.values(pages)) {
    const info = (page as { imageinfo?: Record<string, unknown>[] }).imageinfo?.[0];
    if (!info) continue;
    const src = typeof info.thumburl === 'string' ? info.thumburl : typeof info.url === 'string' ? info.url : null;
    const pageUrl = typeof info.descriptionurl === 'string' ? info.descriptionurl : null;
    if (!src || !pageUrl) continue;
    const host = new URL(src).hostname;
    if (!host.endsWith('.wikimedia.org')) continue;
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: unknown }>;
    return { src, page: pageUrl, artist: plain(meta.Artist?.value), license: plain(meta.LicenseShortName?.value) };
  }
  return null;
}

const photoCache = new Map<string, Promise<CommonsPhoto | null>>();

/** A Commons file ("File:…") resolved to a 960 px thumbnail with its credit; cached per session. */
export function fetchCommonsPhoto(file: string): Promise<CommonsPhoto | null> {
  let pending = photoCache.get(file);
  if (!pending) {
    const params = new URLSearchParams({
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: '960',
      iiextmetadatafilter: 'LicenseShortName|Artist',
      format: 'json',
      origin: '*',
      titles: file,
    });
    pending = fetch(`${COMMONS_API_URL}?${params}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(parseCommonsPhoto);
    photoCache.set(file, pending);
    pending.catch(() => photoCache.delete(file));
  }
  return pending;
}
