import type { StyleSpecification } from 'maplibre-gl';

/** Keep one source of 3D building geometry: the BIN-linked deck.gl footprints. */
export function adaptBasemapStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers
      .filter((layer) => !(layer.type === 'fill' && layer.paint && 'fill-pattern' in layer.paint))
      .map((layer) => {
        // MapLibre's `within` evaluates points/lines, not building polygons. An inverted
        // `within` filter therefore leaves gray extrusions covering our scored buildings.
        const building = 'source-layer' in layer && layer['source-layer'] === 'building';
        return building || layer.type === 'fill-extrusion'
          ? { ...layer, layout: { ...layer.layout, visibility: 'none' as const } }
          : layer;
      }),
  };
}
