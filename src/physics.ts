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

export function mphToMs(mph: number): number {
  return mph * MPH_TO_MS;
}

export function msToMph(ms: number): number {
  return ms / MPH_TO_MS;
}

export function thinkingDistance(speedMs: number, reactionS: number): number {
  return speedMs * reactionS;
}

export function brakingDistance(speedMs: number, grip: number): number {
  return (speedMs * speedMs) / (2 * grip * G);
}

export interface StopBreakdown {
  thinking: number;
  braking: number;
  total: number;
}

export function stoppingDistance(speedMs: number, reactionS: number, grip: number): StopBreakdown {
  const thinking = thinkingDistance(speedMs, reactionS);
  const braking = brakingDistance(speedMs, grip);
  return { thinking, braking, total: thinking + braking };
}

/**
 * Speed (m/s) still being done after travelling `distance` metres from the
 * moment the hazard appeared. Full speed during the thinking distance, then
 * constant deceleration. Returns 0 once stopped.
 */
export function speedAtDistance(speedMs: number, reactionS: number, grip: number, distance: number): number {
  const think = thinkingDistance(speedMs, reactionS);
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

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
