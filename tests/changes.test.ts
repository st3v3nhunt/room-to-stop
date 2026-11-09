import { describe, expect, it } from 'vitest';
import { describeChange, pickChange } from '../src/changes';
import { HIGHWAY_CODE_REACTION_S, SURFACE_GRIP, mphToMs, scoreWhatChanged, speedAtDistance, stoppingDistance } from '../src/physics';
import { mulberry32 } from '../src/models';

const stop = (mph: number, surface: keyof typeof SURFACE_GRIP) =>
  stoppingDistance(mphToMs(mph), HIGHWAY_CODE_REACTION_S, SURFACE_GRIP[surface]).total;

describe('pickChange', () => {
  const rnd = mulberry32(42);
  const levels = Array.from({ length: 500 }, () => pickChange(rnd));

  it('always changes something and always makes the stop longer', () => {
    for (const { before, after } of levels) {
      expect(before.mph !== after.mph || before.surface !== after.surface).toBe(true);
      expect(stop(after.mph, after.surface)).toBeGreaterThan(stop(before.mph, before.surface));
    }
  });
  it('stays within UK limits and keeps icy stops readable', () => {
    for (const { after } of levels) {
      expect(after.mph).toBeLessThanOrEqual(70);
      if (after.surface === 'icy') expect(after.mph).toBeLessThanOrEqual(40);
    }
  });
  it('uses speed-only, surface-only and combined changes', () => {
    const kinds = new Set(levels.map(({ before, after }) => `${before.mph !== after.mph}-${before.surface !== after.surface}`));
    expect(kinds).toEqual(new Set(['true-false', 'false-true', 'true-true']));
  });
  it('describes what changed', () => {
    const text = describeChange({ before: { mph: 30, surface: 'dry' }, after: { mph: 40, surface: 'wet' } });
    expect(text).toContain('(was 30)');
    expect(text).toContain('(was dry)');
  });
});

describe('the design doc example', () => {
  it('40 mph wet passes the old 30 mph dry stop at about 33 mph', () => {
    const old = stop(30, 'dry');
    const v = speedAtDistance(mphToMs(40), HIGHWAY_CODE_REACTION_S, SURFACE_GRIP.wet, old) / mphToMs(1);
    expect(v).toBeGreaterThan(30);
    expect(v).toBeLessThan(36);
  });
});

describe('scoreWhatChanged', () => {
  it('gives full marks for both answers right', () => {
    expect(scoreWhatChanged(50, 50, 33, 33.4).total).toBe(1000);
  });
  it('splits the points between distance and speed', () => {
    const s = scoreWhatChanged(50, 50, 10, 33);
    expect(s.distancePoints).toBe(500);
    expect(s.speedPoints).toBe(0);
    expect(s.total).toBe(500);
  });
  it('allows 2 mph of slack on the speed and falls to zero at 15 mph out', () => {
    expect(scoreWhatChanged(50, 50, 31, 33).speedPoints).toBe(500);
    expect(scoreWhatChanged(50, 50, 18, 33).speedPoints).toBe(0);
    const mid = scoreWhatChanged(50, 50, 25, 33).speedPoints;
    expect(mid).toBeGreaterThan(150);
    expect(mid).toBeLessThan(350);
  });
});
