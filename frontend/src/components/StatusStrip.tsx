import { useMemo } from 'react';
import { INITIAL_VIEW } from '../camera';
import { sunState } from '../data/sunPosition';
import { formatDate } from '../data/formatDate';
import benchmark from '../../../ml/reports/linuxone/latency_s390x.json';

/**
 * Measured model-inference time per score on the deployed service, median over 200 real requests
 * (ml/reports/linuxone/latency_s390x.json). Both engines run the same model on the same LinuxONE
 * machine, so the pair is a like-for-like reading rather than a vendor claim. It covers the model
 * call only: the full request (about 86 ms) is dominated by rebuilding the building's features and
 * is the same on both engines, and energy was not measured, so neither is claimed here.
 */
const INFERENCE_MS = {
  nnpa: benchmark.engines.nnpa.model_inference_ms.median,
  cpu: benchmark.engines.xgboost.model_inference_ms.median,
};
const BENCHMARK_DATE = benchmark.health.platform.timestamp_utc.slice(0, 10);
const BENCHMARK_CONTEXT = `Saved ${BENCHMARK_DATE} benchmark, model ${benchmark.health.model}, ${benchmark.buildings} buildings on ${benchmark.health.platform.machine}. Model-only latency; not this session's timing and not end-to-end speed-up.`;

export interface StatusStripProps {
  scored: number;
  mapped: number;
  dataAsOf: string | null;
  platform: string;
  isMock: boolean;
  selectedBin: string | null;
  movementOn: boolean;
}

/** `drop` marks a readout the bar may shed first when it runs out of width (see glass.css). */
function Readout({ label, value, title, drop, accent }: {
  label: string;
  value: string;
  title?: string;
  drop?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={`readout${drop ? ' readout--drop' : ''}${accent ? ' readout--accent' : ''}`} title={title}>
      <span className="readout__label">{label}</span>
      <span className="readout__value mono">{value}</span>
    </div>
  );
}

/** Floating status bar: what is on screen, where it came from, and what it cost to compute. */
export function StatusStrip({ scored, mapped, dataAsOf, platform, isMock, selectedBin, movementOn }: StatusStripProps) {
  const sun = useMemo(() => sunState(new Date(), INITIAL_VIEW.latitude, INITIAL_VIEW.longitude), []);
  const speedup = INFERENCE_MS.cpu / INFERENCE_MS.nnpa;

  return (
    <footer className="statusbar" aria-label="Session readouts">
      <div className="statusbar__group">
        <Readout label="Scored" value={`${scored.toLocaleString()} / ${mapped.toLocaleString()}`} title="Buildings with a model score, out of footprints rendered in the demo area" />
        <Readout label="As of" value={formatDate(dataAsOf)} title="Latest city record included in the scored data" />
        <Readout label="Selection" value={selectedBin ?? '—'} title="Building Identification Number of the selected footprint" />
      </div>

      <div className="statusbar__group statusbar__group--scene">
        <Readout
          label="Sun"
          value={`${sun.azimuthDeg.toFixed(0)}°az ${sun.altitudeDeg.toFixed(0)}°alt`}
          title="Solar position lighting the scene: 10:00 New York, computed from today's date"
        />
        <Readout label="Movement" value={movementOn ? 'On' : 'Off'} title="Satellite line-of-sight motion layer" />
      </div>

      <div className="statusbar__group statusbar__group--end">
        <Readout
          label={`Saved benchmark · ${BENCHMARK_DATE}`}
          value={`${INFERENCE_MS.nnpa.toFixed(3)} ms NNPA · ${INFERENCE_MS.cpu.toFixed(3)} ms CPU`}
          title={BENCHMARK_CONTEXT}
        />
        <Readout
          label="Model-only speed-up"
          value={`${speedup.toFixed(1)}×`}
          title={BENCHMARK_CONTEXT}
          accent
        />
        <Readout label="Platform" value={isMock ? 'Synthetic demo data' : platform} title="Where the scores were computed" drop />
      </div>
    </footer>
  );
}
