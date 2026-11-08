import { describe, expect, it } from 'vitest';
import {
  HIGHWAY_CODE_REACTION_S,
  SURFACE_GRIP,
  brakingDistance,
  mphToMs,
  scoreHazardStop,
  speedAtDistance,
  step,
  stoppingDistance,
} from '../src/physics';

// Highway Code typical stopping distances (metres) for a car.
const HIGHWAY_CODE = [
  { mph: 20, thinking: 6, braking: 6, total: 12 },
  { mph: 30, thinking: 9, braking: 14, total: 23 },
  { mph: 40, thinking: 12, braking: 24, total: 36 },
  { mph: 50, thinking: 15, braking: 38, total: 53 },
  { mph: 60, thinking: 18, braking: 55, total: 73 },
  { mph: 70, thinking: 21, braking: 75, total: 96 },
];

describe('dry car matches the Highway Code table', () => {
  for (const row of HIGHWAY_CODE) {
    it(`${row.mph} mph`, () => {
      const d = stoppingDistance(mphToMs(row.mph), HIGHWAY_CODE_REACTION_S, SURFACE_GRIP.dry);
      expect(Math.abs(d.thinking - row.thinking)).toBeLessThan(1);
      expect(Math.abs(d.braking - row.braking)).toBeLessThan(1.5);
      expect(Math.abs(d.total - row.total)).toBeLessThan(1.5);
    });
  }
});

describe('surface multipliers', () => {
  const v = mphToMs(40);
  it('wet roughly doubles braking distance', () => {
    const ratio = brakingDistance(v, SURFACE_GRIP.wet) / brakingDistance(v, SURFACE_GRIP.dry);
    expect(ratio).toBeCloseTo(2, 1);
  });
  it('icy is about ten times dry', () => {
    const ratio = brakingDistance(v, SURFACE_GRIP.icy) / brakingDistance(v, SURFACE_GRIP.dry);
    expect(ratio).toBeCloseTo(10, 1);
  });
});

describe('speedAtDistance', () => {
  const v = mphToMs(40);
  const grip = SURFACE_GRIP.wet;
  it('is full speed inside the thinking distance', () => {
    expect(speedAtDistance(v, 0.67, grip, 5)).toBe(v);
  });
  it('is zero beyond the stopping distance', () => {
    const d = stoppingDistance(v, 0.67, grip).total;
    expect(speedAtDistance(v, 0.67, grip, d + 1)).toBe(0);
  });
});

describe('step integration', () => {
  it('stops at the analytic braking distance regardless of frame rate', () => {
    const v = mphToMs(60);
    for (const dt of [1 / 30, 1 / 60, 1 / 144, 0.25]) {
      let s = { position: 0, speed: v };
      while (s.speed > 0) s = step(s, dt, true, SURFACE_GRIP.dry);
      expect(s.position).toBeCloseTo(brakingDistance(v, SURFACE_GRIP.dry), 6);
    }
  });
  it('keeps speed when not braking', () => {
    const s = step({ position: 10, speed: 13 }, 0.5, false, SURFACE_GRIP.dry);
    expect(s).toEqual({ position: 16.5, speed: 13 });
  });
});

describe('scoreHazardStop', () => {
  it('caps at 1,000', () => {
    expect(scoreHazardStop(0.3, false, 20, 10).total).toBe(1000);
  });
  it('scores zero for the gap when the hazard is hit', () => {
    const s = scoreHazardStop(0.4, true, 0, 10);
    expect(s.gapPoints).toBe(0);
    expect(s.stars).toBe(0);
  });
  it('scores zero for reaction at 1.5 s or slower', () => {
    expect(scoreHazardStop(2, false, 5, 10).reactionPoints).toBe(0);
  });
});
