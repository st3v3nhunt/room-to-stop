// The summary shown at the end of a Hazard run or Stop on the line.
import { HIGHWAY_CODE_REACTION_S, SURFACE_LABEL, type Surface, type Vehicle, mphToMs } from './physics';

/** One stop in a game made of several. */
export interface StopRecord {
  mph: number;
  surface: Surface;
  /** stop: stopped in time. hit: reached the hazard. early: braked before it appeared. line: a Stop on the line round. */
  kind: 'stop' | 'hit' | 'early' | 'line';
  /** Seconds, or null if the player never braked (or there was nothing to react to). */
  reaction: number | null;
  /** Metres to spare. In Stop on the line, negative means over the line. */
  gap: number;
  /** Speed (mph) at the hazard or at the stop line, if the vehicle got that far. */
  impactMph: number;
  /** What was in the road, e.g. "deer". */
  hazardName: string;
  /** How much room an alert driver would have had to spare (m). */
  idealGap: number;
  /** Distance (m) from pressing the brake to standing still. */
  braking: number;
  /** Points before the multiplier, the multiplier, and points scored. */
  base: number;
  multiplier: number;
  points: number;
}

export interface JourneySummary {
  mode: 'run' | 'line';
  vehicle: Vehicle;
  score: number;
  /** Best score on this device before this game. */
  previousBest: number;
  records: StopRecord[];
  /** Whether the last stop can be watched again. */
  canReplay: boolean;
}

const $ = (id: string) => document.getElementById(id)!;
const num = (n: number) => n.toLocaleString('en-GB');
const fmtM = (m: number) => `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
const road = (s: Surface) => `${s === 'icy' ? 'an' : 'a'} ${s} road`;
const stat = (label: string, value: string, sub = '') =>
  `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}${sub ? `<span class="stat-sub">${sub}</span>` : ''}</span></div>`;

export function renderSummary(s: JourneySummary): void {
  const isBest = s.score > s.previousBest;
  $('sum-title').textContent = s.mode === 'run' ? 'Run over' : 'Five stops done';
  $('sum-score').innerHTML =
    `${num(s.score)}<small>${isBest ? 'New best!' : s.previousBest > 0 ? `Best ${num(s.previousBest)}` : s.mode === 'line' ? 'out of 5,000' : 'points'}</small>`;
  $('sum-replay').classList.toggle('hidden', !s.canReplay);
  if (s.mode === 'run') renderRun(s);
  else renderLine(s);
}

function renderRun(s: JourneySummary): void {
  const clean = s.records.filter((r) => r.kind === 'stop');
  const reacted = s.records.filter((r) => r.reaction !== null).map((r) => r.reaction!);
  const avg = reacted.length ? reacted.reduce((a, b) => a + b, 0) / reacted.length : null;
  $('sum-stats').innerHTML =
    stat('Clean stops', String(clean.length)) +
    stat('Best reaction', reacted.length ? `${Math.min(...reacted).toFixed(2)} s` : '–') +
    stat('Average reaction', avg === null ? '–' : `${avg.toFixed(2)} s`, `Alert driver ${HIGHWAY_CODE_REACTION_S} s`);

  const last = s.records[s.records.length - 1];
  const parts: string[] = [];
  if (last?.kind === 'hit') {
    parts.push(
      last.reaction === null
        ? `The last one got you: you never braked for the ${last.hazardName} at ${last.mph} mph.`
        : `The last one got you: at ${last.mph} mph on ${road(last.surface)} you reacted in ${last.reaction.toFixed(2)} s and were still doing ${Math.round(last.impactMph)} mph at the ${last.hazardName}. An alert driver would have stopped ${fmtM(last.idealGap)} short.`,
    );
  } else if (last?.kind === 'early') {
    parts.push('Your last life went on braking before anything had appeared.');
  }
  if (avg !== null) {
    parts.push(
      `Your average reaction was ${avg.toFixed(2)} s. At 70 mph that is ${Math.round(mphToMs(70) * avg)} m travelled before the brakes even come on.`,
    );
  }
  $('sum-takeaway').textContent = parts.join(' ');

  $('sum-rows').innerHTML = s.records
    .map((r, i) => {
      const how =
        r.kind === 'early'
          ? 'Braked too early'
          : r.kind === 'hit'
            ? r.reaction === null
              ? `No brake: hit at ${Math.round(r.impactMph)} mph`
              : `${r.reaction.toFixed(2)} s, hit at ${Math.round(r.impactMph)} mph`
            : `${r.reaction!.toFixed(2)} s, ${fmtM(r.gap)} spare`;
      const pts = r.kind === 'stop' ? `${num(r.base)}${r.multiplier > 1 ? ` ×${r.multiplier}` : ''}` : 'Life lost';
      return row(i, r, how, pts, r.kind !== 'stop');
    })
    .join('');
  $('sum-footnote').textContent =
    `Each stop scores up to 1,000: half for your reaction (full marks at 0.25 s, none at 1 s) and half for the room you left. Clean stops in a row multiply it, up to ×5. Hazards always appear far enough away for an alert driver, reacting in ${HIGHWAY_CODE_REACTION_S} s, to stop.`;
}

function renderLine(s: JourneySummary): void {
  const stopped = s.records.filter((r) => r.gap >= 0);
  const over = s.records.length - stopped.length;
  $('sum-stats').innerHTML =
    stat('Closest stop', stopped.length ? fmtM(Math.min(...stopped.map((r) => r.gap))) : '–') +
    stat('Over the line', `${over} of ${s.records.length}`) +
    stat('Average gap', stopped.length ? fmtM(stopped.reduce((a, r) => a + r.gap, 0) / stopped.length) : '–');

  const slow = s.records.find((r) => r.mph === 30 && r.surface === 'dry');
  const fast = s.records.find((r) => r.mph === 70 && r.surface === 'dry');
  const ice = s.records.find((r) => r.surface === 'icy');
  const parts: string[] = [];
  if (slow && fast) {
    parts.push(
      `Braking took ${fmtM(slow.braking)} at 30 mph and ${fmtM(fast.braking)} at 70 mph: a little over twice the speed, more than five times the distance.`,
    );
  }
  if (ice) parts.push(`On ice it took ${fmtM(ice.braking)} from only ${ice.mph} mph.`);
  $('sum-takeaway').textContent = parts.join(' ');

  $('sum-rows').innerHTML = s.records
    .map((r, i) => {
      const how = r.gap >= 0 ? `${fmtM(r.gap)} short` : `${fmtM(-r.gap)} over, at ${Math.round(r.impactMph)} mph`;
      return row(i, r, how, num(r.points), r.gap < 0);
    })
    .join('');
  $('sum-footnote').textContent =
    `Each round scores up to 1,000 for stopping within half a metre of the line, falling to zero when you leave half the braking distance unused. Braking is as hard as a ${s.vehicle} in good condition can manage.`;
}

function row(i: number, r: StopRecord, how: string, pts: string, bad: boolean): string {
  return `<div class="sum-row${bad ? ' bad' : ''}"><span class="n">${i + 1}</span><span class="what">${r.mph} mph ${SURFACE_LABEL[r.surface]}</span><span class="how">${how}</span><span class="pts">${pts}</span></div>`;
}
