export interface LayerControlsProps {
  showRisk: boolean;
  showMovement: boolean;
  movementAvailable: boolean;
  demoRunning: boolean;
  onToggleRisk: () => void;
  onToggleMovement: () => void;
  onPlayDemo: () => void;
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
    <label className={`toggle${disabled ? ' toggle--disabled' : ''}`}>
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
      <Toggle label="Inspection priority" hint="Colour scored buildings by category" checked={showRisk} onChange={onToggleRisk} />
      <Toggle
        label="Satellite movement"
        hint={movementAvailable ? 'InSAR line-of-sight velocity (own legend)' : 'Not in current prediction file'}
        checked={showMovement}
        disabled={!movementAvailable}
        onChange={onToggleMovement}
      />
      <div className="controls__buttons">
        <button type="button" className="btn btn--primary" onClick={onPlayDemo} disabled={demoRunning}>
          <span aria-hidden>▶</span> {demoRunning ? 'Playing…' : 'Play Demo'}
        </button>
        <button type="button" className="btn" onClick={onReset}>
          Reset View
        </button>
      </div>
    </div>
  );
}
