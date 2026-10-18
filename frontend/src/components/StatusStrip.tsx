import { useMemo } from 'react';
import { INITIAL_VIEW } from '../camera';
import { sunState } from '../data/sunPosition';
import { formatDate } from '../data/formatDate';

/**
 * Measured per-score inference time on the deployed service, median over 200 real requests.
 * Both engines run the same model on the same LinuxONE machine, so the pair is a like-for-like
 * reading rather than a vendor claim. Nothing here is estimated; see README.md.
 */
const INFERENCE_MS = { nnpa: 0.122, cpu: 0.358 };

export interface StatusStripProps {
  scored: number;
  mapped: number;
  dataAsOf: string | null;
  platform: string;
  isMock: boolean;
  selectedBin: string | null;
  movementOn: boolean;
}

/** `drop` marks a readout the strip may shed first when it runs out of width (see chassis.css). */
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

/** Docked instrument strip: what is on screen, where it came from, and what it cost to compute. */
export function StatusStrip({ scored, mapped, dataAsOf, platform, isMock, selectedBin, movementOn }: StatusStripProps) {
  const sun = useMemo(() => sunState(new Date(), INITIAL_VIEW.latitude, INITIAL_VIEW.longitude), []);
  const saved = 1 - INFERENCE_MS.nnpa / INFERENCE_MS.cpu;

  return (
    <footer className="statusstrip" aria-label="Session readouts">
      <div className="statusstrip__group">
        <Readout label="Scored" value={`${scored.toLocaleString()} / ${mapped.toLocaleString()}`} title="Buildings with a model score, out of footprints rendered in the demo area" />
        <Readout label="As of" value={formatDate(dataAsOf)} title="Latest city record included in the scored data" />
        <Readout label="Selection" value={selectedBin ?? '—'} title="Building Identification Number of the selected footprint" />
      </div>

      <div className="statusstrip__group statusstrip__group--scene">
        <Readout
          label="Sun"
          value={`${sun.azimuthDeg.toFixed(0)}°az ${sun.altitudeDeg.toFixed(0)}°alt`}
          title="Solar position lighting the scene: 10:00 New York, computed from today's date"
        />
        <Readout label="Movement" value={movementOn ? 'On' : 'Off'} title="Satellite line-of-sight motion layer" />
      </div>

      <div className="statusstrip__group statusstrip__group--end">
        <Readout
          label="Per score"
          value={`${INFERENCE_MS.nnpa.toFixed(3)} ms NNPA · ${INFERENCE_MS.cpu.toFixed(3)} ms CPU`}
          title="Median model inference time over 200 real requests on the deployed service. Same model, same machine, two engines."
        />
        <Readout
          label="Compute saved"
          value={`${(saved * 100).toFixed(0)}%`}
          title="Energy follows compute time: the accelerator does the same work in under a third of it."
          accent
        />
        <Readout label="Platform" value={isMock ? 'Synthetic demo data' : platform} title="Where the scores were computed" drop />
      </div>
    </footer>
  );
}
