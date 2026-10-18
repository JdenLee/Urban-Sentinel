/**
 * Where real data comes from. The live ML API runs on IBM LinuxONE and is reached through an SSH tunnel
 * (ml/deploy/linuxone/RUNBOOK.md); the committed snapshot keeps the demo working without it.
 * The same API serves building history (GET /buildings/{bin}/history) for address lookups.
 */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8000';

export interface PredictionSource {
  id: 'live-api' | 'linuxone-snapshot' | 'mock';
  label: string;
  url: string;
}

const base = import.meta.env.BASE_URL;

/** Tried in order; the first that loads and validates wins. Mock data is the last resort and is badged. */
export const PREDICTION_SOURCES: PredictionSource[] = [
  ...((import.meta.env.VITE_PREDICTIONS_URL as string | undefined)
    ? [{ id: 'live-api' as const, label: 'Custom source', url: import.meta.env.VITE_PREDICTIONS_URL as string }]
    : [{ id: 'live-api' as const, label: 'Live ML API', url: `${API_BASE}/predictions` }]),
  { id: 'linuxone-snapshot', label: 'Exported snapshot', url: `${base}data/linuxone-predictions.json` },
  { id: 'mock', label: 'Mock data', url: `${base}data/mock-predictions.json` },
];

export const GROUND_MOTION_SOURCES = [`${API_BASE}/layers/ground-motion.geojson`, `${base}data/insar-ground-motion.geojson`];

/** NYC Planning Labs GeoSearch (Pelias over NYC's PAD): free, no key, returns BINs for address lookup. */
export const GEOSEARCH_URL =
  (import.meta.env.VITE_GEOSEARCH_URL as string | undefined) || 'https://geosearch.planninglabs.nyc/v2/autocomplete';

/** NYC Building Footprints (Socrata), used to draw a looked-up building outside the demo area. */
export const FOOTPRINTS_URL = 'https://data.cityofnewyork.us/resource/5zhs-2jue.geojson';

/** NYC Building Footprints attributes (BIN → tax lot) and MapPLUTO (tax-lot facts), both Socrata, no key. */
export const FOOTPRINT_ATTRS_URL = 'https://data.cityofnewyork.us/resource/5zhs-2jue.json';
export const PLUTO_URL = 'https://data.cityofnewyork.us/resource/64uk-42ks.json';

/** NYS statewide orthoimagery (NYS ITS Geospatial Services), ArcGIS export endpoint: free, no key. */
export const AERIAL_EXPORT_URL = 'https://orthos.its.ny.gov/arcgis/rest/services/wms/Latest/MapServer/export';

/** Wikimedia Commons API, for the curated landmark photos and their credits. */
export const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
