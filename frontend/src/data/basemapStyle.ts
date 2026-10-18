import type { StyleSpecification } from 'maplibre-gl';

/** Keep one source of 3D building geometry: the BIN-linked deck.gl footprints. */
export function adaptBasemapStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    sources: Object.fromEntries(Object.entries(style.sources).map(([id, source]) => [
      id,
      // OpenFreeMap branding is optional; retain OpenMapTiles and OSM data credits.
      'attribution' in source && typeof source.attribution === 'string'
        ? { ...source, attribution: source.attribution.replace(/<a\b[^>]*>OpenFreeMap<\/a>\s*(?:[·|]\s*)?/gi, '') }
        : source,
    ])),
    layers: style.layers
      .filter((layer) => !(layer.type === 'fill' && layer.paint && 'fill-pattern' in layer.paint))
      .map((layer) => {
        // MapLibre's `within` evaluates points/lines, not building polygons. An inverted
        // `within` filter therefore leaves gray extrusions covering our scored buildings.
        const building = 'source-layer' in layer && layer['source-layer'] === 'building';
        if (layer.type === 'background') return { ...layer, paint: { ...layer.paint, 'background-color': '#e5e5dc' } };
        if (layer.type === 'fill' && 'source-layer' in layer && layer['source-layer'] === 'water') {
          return { ...layer, paint: { ...layer.paint, 'fill-color': '#91b8c8', 'fill-opacity': 1 } };
        }
        return building || layer.type === 'fill-extrusion' || layer.type === 'symbol'
          ? { ...layer, layout: { ...layer.layout, visibility: 'none' as const } }
          : layer;
      }),
  };
}
