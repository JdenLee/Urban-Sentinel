import { useMediaQuery } from '../motion/useMediaQuery';

interface Props {
  mode: 'orbit' | 'pan';
  flat: boolean;
  onMode: (mode: 'orbit' | 'pan') => void;
  onDimension: () => void;
  onNorth: () => void;
  onReset: () => void;
}

export function MapToolbar({ mode, flat, onMode, onDimension, onNorth, onReset }: Props) {
  const touch = useMediaQuery('(pointer: coarse)');
  return <div className="map-tools panel" aria-label="Camera controls">
    <div className="map-tools__buttons">
      {!touch && <button type="button" aria-pressed={!flat && mode === 'orbit'} disabled={flat} onClick={() => onMode('orbit')}>Orbit</button>}
      {!touch && <button type="button" aria-pressed={flat || mode === 'pan'} onClick={() => onMode('pan')}>Pan</button>}
      <button type="button" onClick={onDimension}>{flat ? 'Show 3D' : 'Show 2D'}</button>
      <button type="button" onClick={onNorth}>North ↑</button>
      <button type="button" onClick={onReset}>Reset</button>
    </div>
    <p>{touch ? 'One finger to pan · Two fingers to zoom / rotate' : `${flat || mode === 'pan' ? 'Drag to move' : 'Drag to orbit & tilt'} · Scroll to zoom`}</p>
  </div>;
}
