/**
 * Solar position for the scene's key light.
 *
 * The sun direction is computed from real astronomy rather than picked by eye, so the raking light
 * across a façade falls where it actually would in New York. What is deliberately *not* taken from
 * the clock is the time of day: the whole city is lit at one fixed morning hour. Façade inspection
 * compares buildings against each other, and a sun that moved with the viewer's local time would
 * make the same risk colour read differently depending on when a judge opened the page.
 */

const RAD = Math.PI / 180;

/** Hour the city is lit at, in New York. Morning sun rakes across façades and shows relief. */
const INSPECTION_HOUR = 10;
const CITY_ZONE = 'America/New_York';

/** How far the zone is ahead of UTC at a given instant, in milliseconds. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const f = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(f('year'), f('month') - 1, f('day'), f('hour') % 24, f('minute'), f('second')) - at.getTime();
}

/**
 * The instant of `hour` o'clock in `timeZone`, on whichever day `on` falls in that zone. Resolved
 * through the zone rather than the viewer's machine clock: the scene is lit at New York's morning
 * regardless of where it is being watched from.
 */
function cityTime(on: Date, timeZone: string, hour: number): Date {
  const offset = zoneOffsetMs(on, timeZone);
  const local = new Date(on.getTime() + offset);
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour);
  // The offset can differ between `on` and the target hour across a daylight-saving boundary.
  return new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
}

export interface SunState {
  /** Unit vector towards the sun in deck.gl common space (x east, y north, z up). */
  toSun: [number, number, number];
  /** The same vector reversed: what deck.gl's DirectionalLight calls its direction. */
  direction: [number, number, number];
  altitudeDeg: number;
  /** Degrees clockwise from north. */
  azimuthDeg: number;
  /** 0 while the sun is up, 1 once it is well below the horizon. */
  night: number;
  /** Sky colour reflected by glazing, 0..1 linear rgb. */
  sky: [number, number, number];
  keyIntensity: number;
  ambientIntensity: number;
}

/** Unit vector towards the sun in east/north/up, for a moment and a place on Earth. */
function sunVector(date: Date, latDeg: number, lonDeg: number): [number, number, number] {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000.0
  const meanAnomaly = (357.529 + 0.98560028 * d) * RAD;
  const meanLongitude = (280.459 + 0.98564736 * d) * RAD;
  const eclipticLongitude =
    meanLongitude + (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RAD;
  const obliquity = (23.439 - 0.00000036 * d) * RAD;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );

  const gmstHours = 18.697374558 + 24.06570982441908 * d;
  const localSidereal = (gmstHours * 15 + lonDeg) * RAD;
  const hourAngle = localSidereal - rightAscension;

  const lat = latDeg * RAD;
  const sinDec = Math.sin(declination);
  const cosDec = Math.cos(declination);
  return [
    -cosDec * Math.sin(hourAngle),
    Math.cos(lat) * sinDec - Math.sin(lat) * cosDec * Math.cos(hourAngle),
    Math.sin(lat) * sinDec + Math.cos(lat) * cosDec * Math.cos(hourAngle),
  ];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Key light and sky for a location, at the fixed inspection hour on the given day. */
export function sunState(on: Date, latDeg: number, lonDeg: number): SunState {
  const toSun = sunVector(cityTime(on, CITY_ZONE, INSPECTION_HOUR), latDeg, lonDeg);
  const altitudeDeg = Math.asin(Math.min(1, Math.max(-1, toSun[2]))) / RAD;
  const azimuthDeg = (Math.atan2(toSun[0], toSun[1]) / RAD + 360) % 360;

  const day = smoothstep(-6, 6, altitudeDeg);
  const night = 1 - day;
  const sky: [number, number, number] = [
    mix(0.07, 0.42, day),
    mix(0.09, 0.52, day),
    mix(0.16, 0.68, day),
  ];

  return {
    toSun,
    direction: [-toSun[0], -toSun[1], -toSun[2]],
    altitudeDeg,
    azimuthDeg,
    night,
    sky,
    keyIntensity: mix(0.15, 1.15, day),
    ambientIntensity: mix(0.55, 0.95, day),
  };
}
