// Stopping distance physics for Room to Stop.
// Pure functions only, so the numbers can be unit-tested against the
// Highway Code table independently of the graphics.

export const G = 9.81;
export const MPH_TO_MS = 0.44704;

/** Reaction time the Highway Code table assumes (seconds). */
export const HIGHWAY_CODE_REACTION_S = 0.67;

export type Surface = 'dry' | 'wet' | 'icy';

/**
 * Effective grip (deceleration as a fraction of g) for a car in good
 * condition. Dry is tuned so the car reproduces the Highway Code table.
 * Wet and icy are tuned to the Highway Code multipliers people know:
 * braking distance at least doubles in the wet and can be ten times
 * longer on ice.
 */
export const SURFACE_GRIP: Record<Surface, number> = {
  dry: 0.66,
  wet: 0.33,
  icy: 0.066,
};

export const SURFACE_LABEL: Record<Surface, string> = {
  dry: 'Dry',
  wet: 'Wet',
  icy: 'Icy',
};

export const SPEEDS_MPH = [20, 30, 40, 50, 60, 70] as const;

export type Vehicle = 'car' | 'motorbike' | 'lorry';

export const VEHICLE_LABEL: Record<Vehicle, string> = {
  car: 'Car',
  motorbike: 'Motorbike',
  lorry: 'Lorry',
};

export interface VehicleSpec {
  /**
   * Share of the car's grip this vehicle can use on each surface. These are
   * estimates, not published figures: a motorbike has less rubber on the
   * road and is hit harder by wet and ice; a laden lorry's brakes cannot
   * lock all those tyres as hard as a car's.
   */
  gripFactor: Record<Surface, number>;
  /** Seconds between pressing the brake and the brakes biting (air brakes on a lorry). */
  brakeLagS: number;
}

export const VEHICLES: Record<Vehicle, VehicleSpec> = {
  car: { gripFactor: { dry: 1, wet: 1, icy: 1 }, brakeLagS: 0 },
  motorbike: { gripFactor: { dry: 0.92, wet: 0.8, icy: 0.7 }, brakeLagS: 0 },
  lorry: { gripFactor: { dry: 0.72, wet: 0.72, icy: 0.85 }, brakeLagS: 0.4 },
};

/** Effective grip for this vehicle on this surface. */
export function vehicleGrip(vehicle: Vehicle, surface: Surface): number {
  return SURFACE_GRIP[surface] * VEHICLES[vehicle].gripFactor[surface];
}

/** Stopping distance for a vehicle in good condition, reacting in reactionS seconds. */
export function vehicleStop(speedMs: number, reactionS: number, vehicle: Vehicle, surface: Surface): StopBreakdown {
  return stoppingDistance(speedMs, reactionS, vehicleGrip(vehicle, surface), VEHICLES[vehicle].brakeLagS);
}

export function mphToMs(mph: number): number {
  return mph * MPH_TO_MS;
}

export function msToMph(ms: number): number {
  return ms / MPH_TO_MS;
}

export function thinkingDistance(speedMs: number, reactionS: number): number {
  return speedMs * reactionS;
}

/**
 * Distance from pressing the brake to standing still. Any brake lag is
 * travelled at full speed before the brakes bite.
 */
export function brakingDistance(speedMs: number, grip: number, lagS = 0): number {
  return speedMs * lagS + (speedMs * speedMs) / (2 * grip * G);
}

export interface StopBreakdown {
  thinking: number;
  braking: number;
  total: number;
}

export function stoppingDistance(speedMs: number, reactionS: number, grip: number, lagS = 0): StopBreakdown {
  const thinking = thinkingDistance(speedMs, reactionS);
  const braking = brakingDistance(speedMs, grip, lagS);
  return { thinking, braking, total: thinking + braking };
}

/**
 * Speed (m/s) still being done after travelling `distance` metres from the
 * moment the hazard appeared. Full speed during the thinking distance, then
 * constant deceleration. Returns 0 once stopped.
 */
export function speedAtDistance(speedMs: number, reactionS: number, grip: number, distance: number, lagS = 0): number {
  const think = thinkingDistance(speedMs, reactionS + lagS);
  if (distance <= think) return speedMs;
  const v2 = speedMs * speedMs - 2 * grip * G * (distance - think);
  return v2 > 0 ? Math.sqrt(v2) : 0;
}

export interface MotionState {
  /** Distance travelled since the start of the run (m). */
  position: number;
  /** Current speed (m/s). */
  speed: number;
}

/**
 * Advance the car by dt seconds. If braking, decelerate at grip * g and
 * stop exactly at zero (integrated in closed form, so frame rate does not
 * change the stopping point).
 */
export function step(state: MotionState, dt: number, braking: boolean, grip: number): MotionState {
  if (!braking || state.speed <= 0) {
    return { position: state.position + state.speed * dt, speed: state.speed };
  }
  const a = grip * G;
  const tStop = state.speed / a;
  if (dt >= tStop) {
    return { position: state.position + (state.speed * state.speed) / (2 * a), speed: 0 };
  }
  return {
    position: state.position + state.speed * dt - 0.5 * a * dt * dt,
    speed: state.speed - a * dt,
  };
}

// ---------------------------------------------------------------------------
// Scoring (max 1,000 per level)
// ---------------------------------------------------------------------------

export const MAX_POINTS = 1000;
const REACTION_BEST_S = 0.4;
const REACTION_WORST_S = 1.5;

export interface HazardScore {
  reactionPoints: number;
  gapPoints: number;
  total: number;
  stars: 0 | 1 | 2 | 3;
}

/**
 * Hazard stop score: half for reaction time (0.4 s or faster scores full,
 * 1.5 s or slower scores zero) and half for the gap left to the hazard,
 * relative to the gap an alert driver would have left. Hitting the hazard
 * scores zero for the gap.
 */
export function scoreHazardStop(reactionS: number, hit: boolean, gap: number, idealGap: number): HazardScore {
  const half = MAX_POINTS / 2;
  const rFrac = clamp01((REACTION_WORST_S - reactionS) / (REACTION_WORST_S - REACTION_BEST_S));
  const reactionPoints = Math.round(half * rFrac);
  let gapPoints = 0;
  if (!hit) {
    gapPoints = idealGap <= 0.5 ? half : Math.round(half * clamp01(gap / idealGap));
  }
  const total = reactionPoints + gapPoints;
  const stars = hit ? 0 : total >= 800 ? 3 : total >= 550 ? 2 : 1;
  return { reactionPoints, gapPoints, total, stars };
}

/** Reaction times in a Hazard run: this fast or faster scores full marks, this slow or slower none. */
export const RUN_REACTION_BEST_S = 0.25;
const RUN_REACTION_WORST_S = 1;

/**
 * Hazard run score for a clean stop. Stricter than a Single stop, so there
 * is always something to chase: half for reaction time (0.25 s or faster
 * scores full, 1 s or slower scores zero) and half for the room left,
 * relative to `bestGap`, the room a 0.25 s reaction would have left.
 */
export function scoreRunStop(reactionS: number, gap: number, bestGap: number): number {
  const half = MAX_POINTS / 2;
  const rFrac = clamp01((RUN_REACTION_WORST_S - reactionS) / (RUN_REACTION_WORST_S - RUN_REACTION_BEST_S));
  const gFrac = bestGap <= 0.5 ? 1 : clamp01(gap / bestGap);
  return Math.round(half * rFrac) + Math.round(half * gFrac);
}

export interface PredictionScore {
  /** Guess minus actual stopping distance (m): negative means the guess was short. */
  errorM: number;
  total: number;
  stars: 0 | 1 | 2 | 3;
}

/** Guesses within this share of the real stopping distance score full marks. */
const PREDICT_FULL_FRAC = 0.05;
/** Guesses this far out (as a share of the real distance) or more score zero. */
const PREDICT_ZERO_FRAC = 0.6;
/** Metres of slack, so short stops at low speed are not scored too harshly. */
const PREDICT_SLACK_M = 1;

/**
 * Predict the stop score: how close the player's marker was to where the
 * vehicle really stopped, as a share of the real stopping distance. Within
 * 5% (or 1 m) scores the full 1,000, falling to zero at 60% out.
 */
export function scorePrediction(guess: number, actual: number): PredictionScore {
  const errorM = guess - actual;
  const off = Math.max(0, Math.abs(errorM) - PREDICT_SLACK_M) / actual;
  const frac = clamp01(1 - (off - PREDICT_FULL_FRAC) / (PREDICT_ZERO_FRAC - PREDICT_FULL_FRAC));
  const total = Math.round(MAX_POINTS * frac);
  const stars = total >= 800 ? 3 : total >= 550 ? 2 : total > 0 ? 1 : 0;
  return { errorM, total, stars };
}

export interface WhatChangedScore {
  /** Guess minus actual new stopping distance (m). */
  distanceErrorM: number;
  /** Guessed minus actual speed passing the old stopping point (mph). */
  speedErrorMph: number;
  distancePoints: number;
  speedPoints: number;
  total: number;
  stars: 0 | 1 | 2 | 3;
}

/** Speed guesses within this many mph score full marks for the speed half. */
const SPEED_FULL_MPH = 2;
/** Speed guesses this many mph out or more score zero for the speed half. */
const SPEED_ZERO_MPH = 15;

/**
 * What changed? score: half for the new stopping distance (scored like
 * Predict the stop), half for the speed still being done at the old
 * stopping point (full within 2 mph, zero at 15 mph out).
 */
export function scoreWhatChanged(guessM: number, actualM: number, guessMph: number, actualMph: number): WhatChangedScore {
  const half = MAX_POINTS / 2;
  const distancePoints = Math.round(scorePrediction(guessM, actualM).total / 2);
  const speedErrorMph = guessMph - actualMph;
  const off = Math.abs(speedErrorMph);
  const speedPoints = Math.round(half * clamp01(1 - (off - SPEED_FULL_MPH) / (SPEED_ZERO_MPH - SPEED_FULL_MPH)));
  const total = distancePoints + speedPoints;
  const stars = total >= 800 ? 3 : total >= 550 ? 2 : total > 0 ? 1 : 0;
  return { distanceErrorM: guessM - actualM, speedErrorMph, distancePoints, speedPoints, total, stars };
}

export interface LineScore {
  /** Metres short of the line; negative means the vehicle crossed it. */
  gapM: number;
  total: number;
  stars: 0 | 1 | 2 | 3;
}

/** Stops this close to the line (m) score full marks. */
const LINE_SLACK_M = 0.5;

/**
 * Stop on the line score: how close to the line the vehicle stopped without
 * crossing it. Within half a metre scores the full 1,000, falling to zero
 * when the gap is half the braking distance (plus 3 m, so slow rounds are
 * not scored too harshly). Crossing the line scores zero.
 */
export function scoreLineStop(gapM: number, brakingM: number): LineScore {
  if (gapM < 0) return { gapM, total: 0, stars: 0 };
  const frac = clamp01(1 - (gapM - LINE_SLACK_M) / (brakingM * 0.5 + 3));
  const total = Math.round(MAX_POINTS * frac);
  const stars = total >= 800 ? 3 : total >= 550 ? 2 : total > 0 ? 1 : 0;
  return { gapM, total, stars };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
