import { describe, expect, it } from 'vitest';
import {
  HIGHWAY_CODE_REACTION_S,
  SURFACE_GRIP,
  brakingDistance,
  mphToMs,
  scoreHazardStop,
  scorePrediction,
  speedAtDistance,
  step,
  stoppingDistance,
  vehicleGrip,
  vehicleStop,
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

describe('scorePrediction', () => {
  it('gives full marks within 5%', () => {
    expect(scorePrediction(100, 100).total).toBe(1000);
    expect(scorePrediction(105, 100).total).toBe(1000);
    expect(scorePrediction(94.5, 100).total).toBe(1000);
  });
  it('allows a metre of slack on short stops', () => {
    expect(scorePrediction(13.5, 12).total).toBe(1000);
  });
  it('falls with distance and treats short and long guesses alike', () => {
    const short = scorePrediction(70, 100);
    const long = scorePrediction(130, 100);
    expect(short.total).toBe(long.total);
    expect(short.total).toBeGreaterThan(400);
    expect(short.total).toBeLessThan(600);
    expect(short.errorM).toBeCloseTo(-30);
  });
  it('scores zero and no stars when far out', () => {
    const s = scorePrediction(20, 100);
    expect(s.total).toBe(0);
    expect(s.stars).toBe(0);
  });
  it('awards stars by points', () => {
    expect(scorePrediction(110, 100).stars).toBe(3);
    expect(scorePrediction(125, 100).stars).toBe(2);
    expect(scorePrediction(150, 100).stars).toBe(1);
  });
});

describe('vehicles', () => {
  const v = mphToMs(50);
  const stop = (veh: 'car' | 'motorbike' | 'lorry', s: 'dry' | 'wet' | 'icy') => vehicleStop(v, HIGHWAY_CODE_REACTION_S, veh, s);
  it('a car matches the plain surface grip', () => {
    expect(stop('car', 'dry').total).toBeCloseTo(stoppingDistance(v, HIGHWAY_CODE_REACTION_S, SURFACE_GRIP.dry).total, 6);
  });
  it('a lorry needs noticeably longer, including the air brake lag', () => {
    const car = stop('car', 'dry');
    const lorry = stop('lorry', 'dry');
    expect(lorry.thinking).toBeCloseTo(car.thinking, 6);
    expect(lorry.total / car.total).toBeGreaterThan(1.3);
    expect(lorry.total / car.total).toBeLessThan(1.6);
    expect(lorry.braking).toBeGreaterThan(brakingDistance(v, vehicleGrip('lorry', 'dry')) + 8);
  });
  it('a motorbike is similar when dry and suffers more in the wet', () => {
    const dryRatio = stop('motorbike', 'dry').braking / stop('car', 'dry').braking;
    const wetRatio = stop('motorbike', 'wet').braking / stop('car', 'wet').braking;
    expect(dryRatio).toBeGreaterThan(1);
    expect(dryRatio).toBeLessThan(1.15);
    expect(wetRatio).toBeGreaterThan(dryRatio);
  });
  it('speedAtDistance holds full speed through the brake lag', () => {
    const lag = 0.4;
    const atLagEnd = v * (HIGHWAY_CODE_REACTION_S + lag) - 0.1;
    expect(speedAtDistance(v, HIGHWAY_CODE_REACTION_S, 0.5, atLagEnd, lag)).toBe(v);
    const d = stoppingDistance(v, HIGHWAY_CODE_REACTION_S, 0.5, lag).total;
    expect(speedAtDistance(v, HIGHWAY_CODE_REACTION_S, 0.5, d - 0.001, lag)).toBeLessThan(0.5);
  });
});
