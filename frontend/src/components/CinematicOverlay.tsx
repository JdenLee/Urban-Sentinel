import { useEffect } from 'react';
import { useControl } from 'react-map-gl/maplibre';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';

/** BIN-linked scene overlay. No continuous animation or selection beacon. */
export function CinematicOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  useEffect(() => overlay.setProps(props), [overlay, props]);
  return null;
}
