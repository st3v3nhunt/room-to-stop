// The results panel shown after each hazard stop.
import {
  HIGHWAY_CODE_REACTION_S,
  SURFACE_GRIP,
  type HazardScore,
  type PredictionScore,
  type StopBreakdown,
  type Surface,
  mphToMs,
  msToMph,
  speedAtDistance,
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

/** Put back the parts of the panel that Predict the stop changes. */
function setPanelMode(mode: 'hazard' | 'predict'): void {
  const predict = mode === 'predict';
  $('legend-hazard').classList.toggle('hidden', predict);
  $('legend-guess').classList.toggle('hidden', !predict);
  $('stat-reaction-label').textContent = predict ? 'Your guess' : 'Your reaction';
  $('footnote').textContent = predict
    ? `The driver reacts in ${HIGHWAY_CODE_REACTION_S} s, the Highway Code figure. Braking assumes a car in good condition.`
    : `Alert driver uses the Highway Code reaction time of ${HIGHWAY_CODE_REACTION_S} s. Braking assumes a car in good condition.`;
}

export function renderResults(r: RunResult): void {
  setPanelMode('hazard');
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
  const road = `${r.mph} mph on ${r.surface === 'icy' ? 'an' : 'a'} ${r.surface} road`;
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

// ---------------------------------------------------------------------------
// Predict the stop
// ---------------------------------------------------------------------------

export interface PredictResult {
  surface: Surface;
  mph: number;
  grip: number;
  /** Predicted stopping distance (m) from where the driver sees the hazard. */
  guess: number;
  actual: StopBreakdown;
  score: PredictionScore;
  isBest: boolean;
}

export function renderPredictResults(r: PredictResult): void {
  setPanelMode('predict');
  const spotOn = r.score.total >= 900;
  $('result-title').textContent = spotOn
    ? 'Spot on!'
    : r.score.errorM < 0
      ? 'It went further than you thought'
      : 'It stopped sooner than you thought';
  $('stars').innerHTML = [1, 2, 3].map((i) => `<span class="${i <= r.score.stars ? '' : 'off'}">★</span>`).join('');
  $('stars').setAttribute('aria-label', `${r.score.stars} of 3 stars`);

  $('stat-reaction').innerHTML = fmtM(r.guess);
  $('stat-gap-label').textContent = 'It stopped in';
  $('stat-gap').textContent = fmtM(r.actual.total);
  $('stat-score').innerHTML = `${r.score.total}<span class="stat-sub">${r.isBest ? 'New best!' : 'out of 1,000'}</span>`;

  const d = r.actual;
  const max = Math.max(d.total, r.guess) * 1.12;
  const pct = (m: number) => `${(m / max) * 100}%`;
  $('bars').innerHTML = `
    <div class="bar-row">
      <div class="bar-name">It stopped</div>
      <div class="bar-track">
        <div class="bar think" style="left:0;width:${pct(d.thinking)}" title="Thinking ${fmtM(d.thinking)}">${d.thinking / max > 0.12 ? fmtM(d.thinking) : ''}</div>
        <div class="bar brake" style="left:${pct(d.thinking)};width:${pct(d.braking)}" title="Braking ${fmtM(d.braking)}">${d.braking / max > 0.12 ? fmtM(d.braking) : ''}</div>
        <div class="bar-total" style="left:${pct(d.total)}">${fmtM(d.total)}</div>
        <div class="guess-line" style="left:${pct(r.guess)}"></div>
      </div>
    </div>
    <div class="bar-row">
      <div class="bar-name">You guessed</div>
      <div class="bar-track">
        <div class="bar guess" style="left:0;width:${pct(r.guess)}"></div>
        <div class="bar-total" style="left:${pct(r.guess)}">${fmtM(r.guess)}</div>
      </div>
    </div>`;
  $('takeaway').textContent = predictTakeaway(r);
  $('whatif').textContent = predictWhatIf(r);
}

function predictTakeaway(r: PredictResult): string {
  const d = r.actual;
  const brakingShare = `${Math.round(d.braking)} m of the ${Math.round(d.total)} m was braking, and that part grows with the square of the speed.`;
  if (r.score.total >= 900) return `${r.score.errorM === 0 ? 'Exactly right.' : `Within ${fmtM(Math.abs(r.score.errorM))}.`} ${brakingShare}`;
  if (r.score.errorM < 0) {
    if (r.guess < d.thinking) {
      return `At your marker the brakes had not even come on: the car was still doing ${r.mph} mph. It travelled ${fmtM(d.thinking)} while the driver reacted.`;
    }
    const mph = msToMph(speedAtDistance(mphToMs(r.mph), HIGHWAY_CODE_REACTION_S, r.grip, r.guess));
    return `You were ${fmtM(-r.score.errorM)} short. At your marker the car was still doing ${Math.max(1, Math.round(mph))} mph.`;
  }
  return `You allowed ${fmtM(r.score.errorM)} more than it needed. ${brakingShare}`;
}

function predictWhatIf(r: PredictResult): string {
  const v = mphToMs(r.mph);
  const now = r.actual.total;
  if (r.surface !== 'dry') {
    const dry = stoppingDistance(v, HIGHWAY_CODE_REACTION_S, SURFACE_GRIP.dry).total;
    return `What if the road was dry? It would stop in ${fmtM(dry)}, ${fmtM(now - dry)} shorter.`;
  }
  if (r.mph > 20) {
    const slower = stoppingDistance(mphToMs(r.mph - 10), HIGHWAY_CODE_REACTION_S, r.grip).total;
    return `What if it was doing ${r.mph - 10} mph? It would stop in ${fmtM(slower)}, ${fmtM(now - slower)} shorter.`;
  }
  const wet = stoppingDistance(v, HIGHWAY_CODE_REACTION_S, SURFACE_GRIP.wet).total;
  return `What if the road was wet? It would need ${fmtM(wet)} to stop, ${fmtM(wet - now)} more.`;
}

function fmtM(m: number): string {
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
}
