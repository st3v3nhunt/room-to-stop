// "What changed?" levels: a baseline stop, then one or more variables change.
// Pure functions only, so level generation can be unit-tested.
import { SURFACE_LABEL, type Surface, type Vehicle } from './physics';

export interface Scenario {
  vehicle: Vehicle;
  mph: number;
  surface: Surface;
}

export interface ChangeLevel {
  before: Scenario;
  after: Scenario;
}

/** Surfaces in order of falling grip; a change only ever moves one step along. */
const WORSE_SURFACE: Partial<Record<Surface, Surface>> = { dry: 'wet', wet: 'icy' };

/** Fastest speed allowed on ice after a change, so the stop still fits on screen and stays readable. */
const MAX_ICY_MPH = 40;

/**
 * Pick a baseline and a change that always makes the stop longer, so the
 * vehicle is still moving as it passes the old stopping point. The
 * baseline is always a car; a change can swap it for a lorry or motorbike.
 */
export function pickChange(rnd: () => number): ChangeLevel {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length) % xs.length];
  for (;;) {
    const before: Scenario = {
      vehicle: 'car',
      mph: pick([20, 30, 40, 50, 60]),
      surface: rnd() < 0.7 ? 'dry' : 'wet',
    };
    const kind = pick(['speed', 'surface', 'both', 'vehicle'] as const);
    const after: Scenario = { ...before };
    if (kind === 'vehicle') {
      after.vehicle = pick(['lorry', 'motorbike'] as const);
      return { before, after };
    }
    if (kind !== 'surface') {
      const up = before.mph <= 50 && rnd() < 0.4 ? 20 : 10;
      after.mph = before.mph + up;
    }
    if (kind !== 'speed') after.surface = WORSE_SURFACE[before.surface]!;
    if (after.surface === 'icy' && after.mph > MAX_ICY_MPH) continue;
    return { before, after };
  }
}

const road = (s: Surface) => `${s === 'icy' ? 'an' : 'a'} ${SURFACE_LABEL[s].toLowerCase()} road`;

const aVehicle = (v: Vehicle) => `a ${v}`;

/** For example "a car doing 30 mph on a dry road". */
export function describeScenario(s: Scenario): string {
  return `${aVehicle(s.vehicle)} doing ${s.mph} mph on ${road(s.surface)}`;
}

/** The new scenario, saying what each changed value used to be. */
export function describeChange(level: ChangeLevel): string {
  const { before, after } = level;
  const vehicle =
    after.vehicle !== before.vehicle ? `<strong>${aVehicle(after.vehicle)}</strong> (was ${aVehicle(before.vehicle)})` : aVehicle(after.vehicle);
  const speed = after.mph !== before.mph ? `<strong>${after.mph} mph</strong> (was ${before.mph})` : `${after.mph} mph`;
  const surface =
    after.surface !== before.surface
      ? `<strong>${road(after.surface)}</strong> (was ${SURFACE_LABEL[before.surface].toLowerCase()})`
      : road(after.surface);
  return `${vehicle} doing ${speed} on ${surface}`;
}
