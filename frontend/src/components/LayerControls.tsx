import type { DemoMotion } from './DemoController';

export interface LayerControlsProps {
  showRisk: boolean;
  showMovement: boolean;
  movementAvailable: boolean;
  demoRunning: boolean;
  onToggleRisk: () => void;
  onToggleMovement: () => void;
  onPlayDemo: (motion: DemoMotion) => void;
  onReset: () => void;
}

function Toggle({ label, hint, checked, disabled, onChange }: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label className={`toggle${disabled ? ' toggle--disabled' : ''}`} title={hint}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="toggle__track" aria-hidden>
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        <span className="toggle__hint">{hint}</span>
      </span>
    </label>
  );
}

export function LayerControls(props: LayerControlsProps) {
  const { showRisk, showMovement, movementAvailable, demoRunning, onToggleRisk, onToggleMovement, onPlayDemo, onReset } = props;
  return (
    <div className="controls">
      <Toggle label="Inspection priority" hint="Model scores" checked={showRisk} onChange={onToggleRisk} />
      <Toggle
        label="Satellite movement"
        hint={movementAvailable ? 'Measured line-of-sight motion' : 'No movement data loaded'}
        checked={showMovement}
        disabled={!movementAvailable}
        onChange={onToggleMovement}
      />
      <div className="controls__buttons">
        <button type="button" className="btn btn--primary" onClick={() => onPlayDemo('cinematic')} disabled={demoRunning} title="Play a 30-second animated camera tour">
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true"><path d="M1 1l8 5-8 5z" /></svg>
          {demoRunning ? 'Playing…' : 'Play demo'}
        </button>
        <button type="button" className="btn" onClick={onReset}>
          Reset view
        </button>
      </div>
      <button type="button" className="text-link demo-static" onClick={() => onPlayDemo('reduced')} disabled={demoRunning}>
        Play without camera animation
      </button>
    </div>
  );
}
