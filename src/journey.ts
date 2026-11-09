// Hazard run and Stop on the line: games made of several stops in a row.
// Pure functions only, so level generation can be unit-tested.
import { HIGHWAY_CODE_REACTION_S, VEHICLES, type Surface, type Vehicle, brakingDistance, mphToMs, vehicleGrip, vehicleStop } from './physics';

/** Furthest a hazard is placed, so it is still visible on a phone screen. */
export const MAX_HAZARD_DISTANCE = 230;

// ---------------------------------------------------------------------------
// Hazard run
// ---------------------------------------------------------------------------

export const RUN_LIVES = 3;
export const STOPS_PER_STAGE = 3;
export const MAX_MULTIPLIER = 5;

export interface Stage {
  name: string;
  /** One line shown as the stage starts: what is different now. */
  note: string;
  surface: Surface;
  speeds: readonly number[];
  /** Extra room beyond an alert driver's stopping distance, as a share of it. */
  margin: number;
}

export const STAGES: readonly Stage[] = [
  { name: 'Town streets', note: 'Dry road, town speeds', surface: 'dry', speeds: [20, 30, 30], margin: 0.35 },
  { name: 'Out of town', note: 'Faster now: braking distance grows with the square of speed', surface: 'dry', speeds: [40, 50], margin: 0.3 },
  { name: 'Rain', note: 'Wet road: braking distances double', surface: 'wet', speeds: [30, 40, 50], margin: 0.28 },
  { name: 'Fast road', note: 'Dry again, at 60 and 70 mph', surface: 'dry', speeds: [60, 70], margin: 0.22 },
  { name: 'Black ice', note: 'Braking distances up to ten times longer', surface: 'icy', speeds: [20, 20, 30], margin: 0.25 },
  { name: 'Fast road in the rain', note: 'Wet and fast: leave a lot of room', surface: 'wet', speeds: [50, 60, 70], margin: 0.2 },
];

export interface Leg {
  /** Stop number, from 0. */
  index: number;
  /** Stage number, from 0. Stages past the end of STAGES mix every road and speed. */
  stage: number;
  stageName: string;
  stageNote: string;
  /** Whether this is the first stop of its stage. */
  newStage: boolean;
  mph: number;
  surface: Surface;
  margin: number;
}

/** How far ahead (m) the hazard appears: an alert driver stops with `margin` to spare. */
export function hazardDistance(mph: number, surface: Surface, vehicle: Vehicle, margin: number): number {
  return vehicleStop(mphToMs(mph), HIGHWAY_CODE_REACTION_S, vehicle, surface).total * (1 + margin) + 2;
}

/**
 * Speeds from the list this vehicle can be stopped from within sight of the
 * hazard. If none fit, the fastest slower speed that does.
 */
function fairSpeeds(speeds: readonly number[], surface: Surface, vehicle: Vehicle, margin: number): number[] {
  const fits = (mph: number) => hazardDistance(mph, surface, vehicle, margin) <= MAX_HAZARD_DISTANCE;
  const ok = speeds.filter(fits);
  if (ok.length > 0) return ok;
  for (let mph = Math.min(...speeds) - 10; mph > 10; mph -= 10) if (fits(mph)) return [mph];
  return [10];
}

/** The stop at position `index` in a Hazard run: stages get faster, wetter and tighter. */
export function pickLeg(index: number, vehicle: Vehicle, rnd: () => number): Leg {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length) % xs.length];
  const stage = Math.floor(index / STOPS_PER_STAGE);
  const newStage = index % STOPS_PER_STAGE === 0;
  if (stage < STAGES.length) {
    const s = STAGES[stage];
    const mph = pick(fairSpeeds(s.speeds, s.surface, vehicle, s.margin));
    return { index, stage, stageName: s.name, stageNote: s.note, newStage, mph, surface: s.surface, margin: s.margin };
  }
  // Past the last stage: any road, any speed, with less and less room to spare.
  const roll = rnd();
  const surface: Surface = roll < 0.4 ? 'dry' : roll < 0.8 ? 'wet' : 'icy';
  const margin = Math.max(0.05, 0.18 - 0.02 * (stage - STAGES.length));
  const speeds = surface === 'icy' ? [20, 30] : [30, 40, 50, 60, 70];
  const mph = pick(fairSpeeds(speeds, surface, vehicle, margin));
  return { index, stage, stageName: 'Anything goes', stageNote: 'Any road, any speed, less room to spare', newStage, mph, surface, margin };
}

/** Points multiplier for a stop made after `streak` clean stops in a row. */
export function multiplier(streak: number): number {
  return Math.min(MAX_MULTIPLIER, streak + 1);
}

/** A word for a reaction time, against the Highway Code's 0.67 s. */
export function reactionRating(seconds: number): string {
  if (seconds < 0.3) return 'Lightning';
  if (seconds < 0.45) return 'Sharp';
  if (seconds <= HIGHWAY_CODE_REACTION_S) return 'Alert';
  if (seconds < 1) return 'Slow';
  return 'Too slow';
}

/**
 * Brake time is sped up for long slides so a stop on ice does not take 20
 * seconds to watch. Returns how many times faster than real time to play it.
 */
export function fastForward(speedMs: number, grip: number): number {
  const seconds = speedMs / (grip * 9.81);
  return seconds <= 5.5 ? 1 : Math.min(4, seconds / 4.5);
}

// ---------------------------------------------------------------------------
// Stop on the line
// ---------------------------------------------------------------------------

export const LINE_ROUNDS: readonly { mph: number; surface: Surface }[] = [
  { mph: 30, surface: 'dry' },
  { mph: 50, surface: 'dry' },
  { mph: 40, surface: 'wet' },
  { mph: 70, surface: 'dry' },
  { mph: 20, surface: 'icy' },
];

export interface LineRound {
  mph: number;
  surface: Surface;
  /** Distance (m) from pressing the brake to standing still. */
  braking: number;
  /** Road position (m) of the stop line. */
  lineP: number;
}

/** Round `i` of Stop on the line. The run-up varies so the brake point cannot be counted out. */
export function lineRound(i: number, vehicle: Vehicle, rnd: () => number): LineRound {
  const { mph, surface } = LINE_ROUNDS[i % LINE_ROUNDS.length];
  const v = mphToMs(mph);
  const braking = brakingDistance(v, vehicleGrip(vehicle, surface), VEHICLES[vehicle].brakeLagS);
  const runUp = 2.4 + rnd() * 1.8;
  return { mph, surface, braking, lineP: v * runUp + braking };
}
