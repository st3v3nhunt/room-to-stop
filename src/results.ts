// The results panel shown after each hazard stop.
import {
  HIGHWAY_CODE_REACTION_S,
  SURFACE_GRIP,
  type HazardScore,
  type StopBreakdown,
  type Surface,
  mphToMs,
  stoppingDistance,
} from './physics';

export interface RunResult {
  surface: Surface;
  mph: number;
  grip: number;
  /** Seconds, or null if the player never braked. */
  reaction: number | null;
  hazardName: string;
  /** Distance from the car to the hazard when it appeared (m). */
  hazardDistance: number;
  actual: StopBreakdown | null;
  ideal: StopBreakdown;
  hit: boolean;
  impactMph: number;
  gap: number;
  score: HazardScore;
  isBest: boolean;
}

const $ = (id: string) => document.getElementById(id)!;

export function renderResults(r: RunResult): void {
  $('result-title').textContent = r.hit ? `You hit the ${r.hazardName}` : 'You stopped in time';
  $('stars').innerHTML = [1, 2, 3].map((i) => `<span class="${i <= r.score.stars ? '' : 'off'}">★</span>`).join('');
  $('stars').setAttribute('aria-label', `${r.score.stars} of 3 stars`);

  $('stat-reaction').innerHTML =
    r.reaction === null
      ? 'No brake'
      : `${r.reaction.toFixed(2)} s<span class="stat-sub">Alert driver ${HIGHWAY_CODE_REACTION_S} s</span>`;
  $('stat-gap-label').textContent = r.hit ? 'Speed at impact' : 'Gap to hazard';
  $('stat-gap').textContent = r.hit ? `${Math.round(r.impactMph)} mph` : fmtM(r.gap);
  $('stat-score').innerHTML = `${r.score.total}<span class="stat-sub">${r.isBest ? 'New best!' : 'out of 1,000'}</span>`;

  renderBars(r);
  $('takeaway').textContent = takeaway(r);
  $('whatif').textContent = whatIf(r);
}

function renderBars(r: RunResult): void {
  const yours: StopBreakdown = r.actual ?? { thinking: r.hazardDistance, braking: 0, total: r.hazardDistance };
  const max = Math.max(yours.total, r.ideal.total, r.hazardDistance) * 1.12;
  const pct = (m: number) => `${(m / max) * 100}%`;
  const row = (name: string, d: StopBreakdown) => `
    <div class="bar-row">
      <div class="bar-name">${name}</div>
      <div class="bar-track">
        <div class="bar think" style="left:0;width:${pct(d.thinking)}" title="Thinking ${fmtM(d.thinking)}">${d.thinking / max > 0.12 ? fmtM(d.thinking) : ''}</div>
        <div class="bar brake" style="left:${pct(d.thinking)};width:${pct(d.braking)}" title="Braking ${fmtM(d.braking)}">${d.braking / max > 0.12 ? fmtM(d.braking) : ''}</div>
        <div class="bar-total" style="left:${pct(d.total)}">${fmtM(d.total)}</div>
        <div class="hazard-line" style="left:${pct(r.hazardDistance)}"></div>
      </div>
    </div>`;
  $('bars').innerHTML = row(r.actual ? 'You' : 'You (no brake)', yours) + row('Alert driver', r.ideal);
}

function takeaway(r: RunResult): string {
  const road = `${r.mph} mph on a ${r.surface} road`;
  if (r.hit && r.hazardDistance < r.ideal.total) {
    return `Even an alert driver could not have stopped in time. At ${road} you need ${Math.round(r.ideal.total)} m to stop, and the ${r.hazardName} was only ${Math.round(r.hazardDistance)} m away.`;
  }
  if (r.hit && r.reaction === null) {
    return `You didn't brake. An alert driver would have stopped ${fmtM(r.hazardDistance - r.ideal.total)} short of the ${r.hazardName}.`;
  }
  if (r.hit) {
    return `You were still doing ${Math.round(r.impactMph)} mph when you reached the ${r.hazardName}. An alert driver would have stopped ${fmtM(r.hazardDistance - r.ideal.total)} short.`;
  }
  if (r.reaction !== null && r.actual) {
    const extra = r.actual.thinking - r.ideal.thinking;
    if (extra > 1.5) {
      return `Your reaction added ${fmtM(extra)} of thinking distance before the brakes even came on.`;
    }
  }
  if (r.surface === 'wet') return 'On a wet road your braking distance doubled compared with a dry one.';
  if (r.surface === 'icy') return 'On ice your braking distance was about ten times longer than on a dry road.';
  if (r.reaction !== null && r.reaction <= HIGHWAY_CODE_REACTION_S) {
    return `Sharp reactions. Even so, you travelled ${fmtM(r.actual!.thinking)} before your foot reached the brake.`;
  }
  return `At ${road}, most of your stopping distance happened after you braked.`;
}

function whatIf(r: RunResult): string {
  const reaction = r.reaction ?? HIGHWAY_CODE_REACTION_S;
  const now = stoppingDistance(mphToMs(r.mph), reaction, r.grip);
  const who = r.reaction === null ? 'an alert driver' : 'you';
  if (r.surface !== 'dry') {
    const dry = stoppingDistance(mphToMs(r.mph), reaction, SURFACE_GRIP.dry);
    const ok = dry.total < r.hazardDistance;
    return `What if the road was dry? With the same reaction, ${who} would stop in ${fmtM(dry.total)}, ${fmtM(now.total - dry.total)} shorter${r.hit && ok ? ', clear of the hazard' : ''}.`;
  }
  if (r.mph > 20) {
    const slower = stoppingDistance(mphToMs(r.mph - 10), reaction, r.grip);
    const ok = slower.total < r.hazardDistance;
    return `What if you were doing ${r.mph - 10} mph? With the same reaction, ${who} would stop in ${fmtM(slower.total)}, ${fmtM(now.total - slower.total)} shorter${r.hit && ok ? ', clear of the hazard' : ''}.`;
  }
  const wet = stoppingDistance(mphToMs(r.mph), reaction, SURFACE_GRIP.wet);
  return `What if the road was wet? With the same reaction, ${who} would need ${fmtM(wet.total)} to stop, ${fmtM(wet.total - now.total)} more.`;
}

function fmtM(m: number): string {
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
}
