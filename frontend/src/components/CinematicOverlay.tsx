import { useEffect } from 'react';
import { useControl } from 'react-map-gl/maplibre';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import type { ColumnLayer } from '@deck.gl/layers';

/** Animate only the one selected beacon; keep the city geometry and React tree stable. */
export function CinematicOverlay(props: Omit<MapboxOverlayProps, 'layers'> & { layers: Layer[] }) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  useEffect(() => overlay.setProps(props), [overlay, props]);

  useEffect(() => {
    const layers = props.layers;
    const index = layers.findIndex((layer) => layer.id === 'selected-beacon');
    if (index < 0) return;
    const beacon = layers[index] as ColumnLayer;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const wave = (1 - Math.cos((now - start) * Math.PI * 2 / 2800)) / 2;
      const next = [...layers];
      next[index] = beacon.clone({
        radius: 3.5 + wave * 1.5,
        getFillColor: [160, 240, 255, Math.round(40 + 20 * (1 - wave))],
      });
      overlay.setProps({ layers: next });
      frame = requestAnimationFrame(animate);
    };
    const syncMotion = () => {
      cancelAnimationFrame(frame);
      overlay.setProps({ layers });
      if (!preference.matches && !document.hidden) frame = requestAnimationFrame(animate);
    };
    syncMotion();
    preference.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncMotion);
    return () => {
      cancelAnimationFrame(frame);
      preference.removeEventListener('change', syncMotion);
      document.removeEventListener('visibilitychange', syncMotion);
    };
  }, [overlay, props.layers]);
  return null;
}
