import { useEffect } from 'react';
import { useControl } from 'react-map-gl/maplibre';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';

/** BIN-linked overlay; redraw during the entrance or active selected-pin motion. */
export function CinematicOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  useEffect(() => overlay.setProps(props), [overlay, props]);
  return null;
}
