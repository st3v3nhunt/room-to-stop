import { describe, expect, it } from 'vitest';
import {
  LINE_ROUNDS,
  MAX_HAZARD_DISTANCE,
  STAGES,
  STOPS_PER_STAGE,
  fastForward,
  hazardDistance,
  lineRound,
  multiplier,
  pickLeg,
  reactionRating,
} from '../src/journey';
import { HIGHWAY_CODE_REACTION_S, type Vehicle, mphToMs, scoreLineStop, scoreRunStop, vehicleGrip, vehicleStop } from '../src/physics';
import { mulberry32 } from '../src/models';

const VEHICLES: Vehicle[] = ['car', 'motorbike', 'lorry'];

describe('pickLeg', () => {
  it('starts in town on a dry road and marks the first stop of each stage', () => {
    const rnd = mulberry32(1);
    const first = pickLeg(0, 'car', rnd);
    expect(first.surface).toBe('dry');
    expect(first.mph).toBeLessThanOrEqual(30);
    expect(first.newStage).toBe(true);
    expect(pickLeg(1, 'car', rnd).newStage).toBe(false);
    expect(pickLeg(STOPS_PER_STAGE, 'car', rnd).stage).toBe(1);
  });

  it('always leaves an alert driver room to stop, within sight, for every vehicle', () => {
    const rnd = mulberry32(7);
    for (const vehicle of VEHICLES) {
      for (let i = 0; i < 200; i++) {
        const leg = pickLeg(i, vehicle, rnd);
        const d = hazardDistance(leg.mph, leg.surface, vehicle, leg.margin);
        const ideal = vehicleStop(mphToMs(leg.mph), HIGHWAY_CODE_REACTION_S, vehicle, leg.surface).total;
        expect(d).toBeLessThanOrEqual(MAX_HAZARD_DISTANCE);
        expect(d).toBeGreaterThan(ideal + 2);
        expect(leg.mph).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('follows the stage list, then keeps going with less room to spare', () => {
    const rnd = mulberry32(3);
    STAGES.forEach((s, i) => {
      const leg = pickLeg(i * STOPS_PER_STAGE, 'car', rnd);
      expect(leg.stageName).toBe(s.name);
      expect(leg.surface).toBe(s.surface);
    });
    const late = pickLeg((STAGES.length + 10) * STOPS_PER_STAGE, 'car', rnd);
    expect(late.stageName).toBe('Anything goes');
    expect(late.margin).toBeCloseTo(0.05);
  });
});

describe('run scoring helpers', () => {
  it('builds the multiplier with the streak and caps it', () => {
    expect([0, 1, 2, 4, 9].map(multiplier)).toEqual([1, 2, 3, 5, 5]);
  });

  it('scores a clean stop on reaction and room left, with something left to chase', () => {
    expect(scoreRunStop(0.25, 10, 10)).toBe(1000);
    expect(scoreRunStop(0.2, 12, 10)).toBe(1000);
    expect(scoreRunStop(1.2, 0, 10)).toBe(0);
    expect(scoreRunStop(0.4, 8, 10)).toBeLessThan(scoreRunStop(0.3, 9, 10));
    expect(scoreRunStop(0.67, 4, 10)).toBeGreaterThan(300);
  });

  it('rates reactions against the Highway Code figure', () => {
    expect(reactionRating(0.25)).toBe('Lightning');
    expect(reactionRating(0.4)).toBe('Sharp');
    expect(reactionRating(0.67)).toBe('Alert');
    expect(reactionRating(0.8)).toBe('Slow');
    expect(reactionRating(1.4)).toBe('Too slow');
  });

  it('only speeds up long slides', () => {
    expect(fastForward(mphToMs(70), vehicleGrip('car', 'dry'))).toBe(1);
    expect(fastForward(mphToMs(70), vehicleGrip('car', 'wet'))).toBeGreaterThan(1);
    expect(fastForward(mphToMs(30), vehicleGrip('car', 'icy'))).toBe(4);
  });
});

describe('Stop on the line', () => {
  it('puts the line a few seconds of driving beyond the braking distance', () => {
    const rnd = mulberry32(9);
    for (const vehicle of VEHICLES) {
      LINE_ROUNDS.forEach((_, i) => {
        const r = lineRound(i, vehicle, rnd);
        const runUp = (r.lineP - r.braking) / mphToMs(r.mph);
        expect(runUp).toBeGreaterThanOrEqual(2.4);
        expect(runUp).toBeLessThanOrEqual(4.2);
      });
    }
  });

  it('scores full marks on the line, less further back and nothing over it', () => {
    expect(scoreLineStop(0.3, 40).total).toBe(1000);
    expect(scoreLineStop(5, 40).total).toBeLessThan(scoreLineStop(2, 40).total);
    expect(scoreLineStop(23.5, 40).total).toBe(0);
    expect(scoreLineStop(-0.1, 40)).toMatchObject({ total: 0, stars: 0 });
  });
});
