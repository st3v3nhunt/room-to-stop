// The results panel shown after each hazard stop.
import {
  HIGHWAY_CODE_REACTION_S,
  VEHICLES,
  type HazardScore,
  type PredictionScore,
  type WhatChangedScore,
  type StopBreakdown,
  type Surface,
  mphToMs,
  msToMph,
  speedAtDistance,
  type Vehicle,
  vehicleGrip,
  vehicleStop,
} from './physics';
import { type ChangeLevel, describeScenario } from './changes';

export interface RunResult {
  vehicle: Vehicle;
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
/** What the braking figures assume, e.g. "a lorry in good condition, with 0.4 s for its air brakes to bite". */
function vehicleNote(v: Vehicle): string {
  const lag = VEHICLES[v].brakeLagS;
  return `a ${v} in good condition${lag > 0 ? `, with ${lag} s for its air brakes to bite` : ''}`;
}

function setPanelMode(mode: 'hazard' | 'predict' | 'changed', vehicle: Vehicle = 'car'): void {
  const predict = mode !== 'hazard';
  $('legend-hazard').classList.toggle('hidden', predict);
  $('legend-guess').classList.toggle('hidden', !predict);
  $('legend-before').classList.toggle('hidden', mode !== 'changed');
  $('stat-reaction-label').textContent = mode === 'changed' ? 'New distance' : predict ? 'Your guess' : 'Your reaction';
  $('change').textContent = mode === 'changed' ? 'Menu' : 'Change settings';
  $('footnote').textContent = predict
    ? `The driver reacts in ${HIGHWAY_CODE_REACTION_S} s, the Highway Code figure. Braking assumes ${vehicleNote(vehicle)}.`
    : `Alert driver uses the Highway Code reaction time of ${HIGHWAY_CODE_REACTION_S} s. Braking assumes ${vehicleNote(vehicle)}.`;
}

export function renderResults(r: RunResult): void {
  setPanelMode('hazard', r.vehicle);
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
  const lag = VEHICLES[r.vehicle].brakeLagS;
  if (lag > 0) {
    return `A lorry's air brakes take about ${lag} s to bite, so it travelled another ${fmtM(mphToMs(r.mph) * lag)} at full speed after you pressed the brake.`;
  }
  if (r.vehicle === 'motorbike' && r.surface !== 'dry') {
    const car = vehicleStop(mphToMs(r.mph), r.reaction ?? HIGHWAY_CODE_REACTION_S, 'car', r.surface);
    return `With less rubber on the road, a motorbike on ${r.surface === 'icy' ? 'ice' : 'a wet road'} needed ${fmtM((r.actual ?? r.ideal).total - car.total)} more than a car would.`;
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
  const stop = (mph: number, surface: Surface, vehicle: Vehicle = r.vehicle) => vehicleStop(mphToMs(mph), reaction, vehicle, surface);
  const now = stop(r.mph, r.surface);
  const who = r.reaction === null ? 'an alert driver' : 'you';
  const clear = (d: number) => (r.hit && d < r.hazardDistance ? ', clear of the hazard' : '');
  if (r.vehicle !== 'car') {
    const car = stop(r.mph, r.surface, 'car');
    return `What if it was a car? With the same reaction, ${who} would stop in ${fmtM(car.total)}, ${fmtM(now.total - car.total)} shorter${clear(car.total)}.`;
  }
  if (r.surface !== 'dry') {
    const dry = stop(r.mph, 'dry');
    return `What if the road was dry? With the same reaction, ${who} would stop in ${fmtM(dry.total)}, ${fmtM(now.total - dry.total)} shorter${clear(dry.total)}.`;
  }
  if (r.mph > 20) {
    const slower = stop(r.mph - 10, r.surface);
    return `What if you were doing ${r.mph - 10} mph? With the same reaction, ${who} would stop in ${fmtM(slower.total)}, ${fmtM(now.total - slower.total)} shorter${clear(slower.total)}.`;
  }
  const wet = stop(r.mph, 'wet');
  return `What if the road was wet? With the same reaction, ${who} would need ${fmtM(wet.total)} to stop, ${fmtM(wet.total - now.total)} more.`;
}

// ---------------------------------------------------------------------------
// Predict the stop
// ---------------------------------------------------------------------------

export interface PredictResult {
  vehicle: Vehicle;
  surface: Surface;
  mph: number;
  /** Predicted stopping distance (m) from where the driver sees the hazard. */
  guess: number;
  actual: StopBreakdown;
  score: PredictionScore;
  isBest: boolean;
}

export function renderPredictResults(r: PredictResult): void {
  setPanelMode('predict', r.vehicle);
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
      return `At your marker the brakes had not even come on: the ${r.vehicle} was still doing ${r.mph} mph. It travelled ${fmtM(d.thinking)} while the driver reacted.`;
    }
    const mph = msToMph(
      speedAtDistance(mphToMs(r.mph), HIGHWAY_CODE_REACTION_S, vehicleGrip(r.vehicle, r.surface), r.guess, VEHICLES[r.vehicle].brakeLagS),
    );
    return `You were ${fmtM(-r.score.errorM)} short. At your marker the ${r.vehicle} was still doing ${Math.max(1, Math.round(mph))} mph.`;
  }
  return `You allowed ${fmtM(r.score.errorM)} more than it needed. ${brakingShare}`;
}

function predictWhatIf(r: PredictResult): string {
  const stop = (mph: number, surface: Surface, vehicle: Vehicle = r.vehicle) =>
    vehicleStop(mphToMs(mph), HIGHWAY_CODE_REACTION_S, vehicle, surface).total;
  const now = r.actual.total;
  if (r.vehicle !== 'car') {
    const car = stop(r.mph, r.surface, 'car');
    return `What if it was a car? It would stop in ${fmtM(car)}, ${fmtM(now - car)} shorter.`;
  }
  if (r.surface !== 'dry') {
    const dry = stop(r.mph, 'dry');
    return `What if the road was dry? It would stop in ${fmtM(dry)}, ${fmtM(now - dry)} shorter.`;
  }
  if (r.mph > 20) {
    const slower = stop(r.mph - 10, r.surface);
    return `What if it was doing ${r.mph - 10} mph? It would stop in ${fmtM(slower)}, ${fmtM(now - slower)} shorter.`;
  }
  const wet = stop(r.mph, 'wet');
  return `What if the road was wet? It would need ${fmtM(wet)} to stop, ${fmtM(wet - now)} more.`;
}

function fmtM(m: number): string {
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
}

// ---------------------------------------------------------------------------
// What changed?
// ---------------------------------------------------------------------------

export interface ChangedResult {
  level: ChangeLevel;
  before: StopBreakdown;
  after: StopBreakdown;
  /** Predicted new stopping distance (m). */
  guess: number;
  /** Predicted and real speed (mph) passing the old stopping point. */
  crossGuess: number;
  crossActual: number;
  score: WhatChangedScore;
  isBest: boolean;
}

export function renderChangedResults(r: ChangedResult): void {
  setPanelMode('changed');
  const s = r.score;
  $('result-title').textContent =
    s.total >= 900 ? 'Spot on!' : s.distanceErrorM < 0 ? 'It needed more room than you thought' : 'It stopped sooner than you thought';
  $('stars').innerHTML = [1, 2, 3].map((i) => `<span class="${i <= s.stars ? '' : 'off'}">★</span>`).join('');
  $('stars').setAttribute('aria-label', `${s.stars} of 3 stars`);

  $('stat-reaction').innerHTML = `${fmtM(r.after.total)}<span class="stat-sub">You said ${fmtM(r.guess)}</span>`;
  $('stat-gap-label').textContent = 'Speed at old stop';
  $('stat-gap').innerHTML = `${Math.round(r.crossActual)} mph<span class="stat-sub">You said ${r.crossGuess} mph</span>`;
  $('stat-score').innerHTML = `${s.total}<span class="stat-sub">${r.isBest ? 'New best!' : 'out of 1,000'}</span>`;

  const max = Math.max(r.after.total, r.guess, r.before.total) * 1.12;
  const pct = (m: number) => `${(m / max) * 100}%`;
  const stopRow = (name: string, d: StopBreakdown, extra = '') => `
    <div class="bar-row">
      <div class="bar-name">${name}</div>
      <div class="bar-track">
        <div class="bar think" style="left:0;width:${pct(d.thinking)}" title="Thinking ${fmtM(d.thinking)}">${d.thinking / max > 0.12 ? fmtM(d.thinking) : ''}</div>
        <div class="bar brake" style="left:${pct(d.thinking)};width:${pct(d.braking)}" title="Braking ${fmtM(d.braking)}">${d.braking / max > 0.12 ? fmtM(d.braking) : ''}</div>
        <div class="bar-total" style="left:${pct(d.total)}">${fmtM(d.total)}</div>
        ${extra}
      </div>
    </div>`;
  $('bars').innerHTML =
    stopRow('Before', r.before) +
    stopRow('Now', r.after, `<div class="guess-line" style="left:${pct(r.guess)}"></div><div class="before-line" style="left:${pct(r.before.total)}"></div>`) +
    `<div class="bar-row">
      <div class="bar-name">You guessed</div>
      <div class="bar-track">
        <div class="bar guess" style="left:0;width:${pct(r.guess)}"></div>
        <div class="bar-total" style="left:${pct(r.guess)}">${fmtM(r.guess)}</div>
      </div>
    </div>`;
  $('takeaway').textContent = changedTakeaway(r);
  $('whatif').textContent = changedExplain(r);
  const lag = VEHICLES[r.level.after.vehicle].brakeLagS;
  $('footnote').textContent =
    `Both stops use the Highway Code reaction time of ${HIGHWAY_CODE_REACTION_S} s and vehicles in good condition` +
    (lag > 0 ? `; the lorry's air brakes take ${lag} s to bite.` : '.');
}

function changedTakeaway(r: ChangedResult): string {
  const { before, after } = r.level;
  return (
    `Going from ${describeScenario(before)} to ${describeScenario(after)}, the ${after.vehicle} was still doing ` +
    `${Math.round(r.crossActual)} mph where it stopped before, and needed ${fmtM(r.after.total - r.before.total)} more to stop.`
  );
}

/** Which part of the stop grew, and why. */
function changedExplain(r: ChangedResult): string {
  const { before, after } = r.level;
  const dThink = r.after.thinking - r.before.thinking;
  const dBrake = r.after.braking - r.before.braking;
  const parts: string[] = [];
  if (after.vehicle !== before.vehicle) {
    const lag = VEHICLES[after.vehicle].brakeLagS;
    parts.push(
      `Thinking distance stayed at ${fmtM(r.after.thinking)}: the same driver reacts just as fast.`,
      after.vehicle === 'lorry'
        ? `Braking distance went from ${fmtM(r.before.braking)} to ${fmtM(r.after.braking)}: a heavy lorry cannot brake as hard as a car, and its air brakes take ${lag} s to bite, ${fmtM(mphToMs(after.mph) * lag)} at full speed.`
        : `Braking distance went from ${fmtM(r.before.braking)} to ${fmtM(r.after.braking)}: a motorbike has two small tyre patches on the road, so it cannot brake as hard as a car${after.surface === 'dry' ? '' : `, and ${after.surface === 'icy' ? 'ice' : 'the wet'} makes that worse`}.`,
    );
    return parts.join(' ');
  }
  if (after.mph !== before.mph) {
    const ratio = (after.mph / before.mph) ** 2;
    parts.push(
      `Thinking distance grew by ${fmtM(dThink)}, in step with the speed.`,
      after.surface === before.surface
        ? `Braking distance grew by ${fmtM(dBrake)}: going ${Math.round((after.mph / before.mph - 1) * 100)}% faster made it ${ratio.toFixed(1)} times as long, because it grows with the square of the speed.`
        : `Braking distance grew by ${fmtM(dBrake)}: the extra speed makes it grow with the square of the speed, and the ${after.surface} road cut the grip as well.`,
    );
  } else {
    parts.push(
      `Thinking distance stayed at ${fmtM(r.after.thinking)}: the road surface does not change how long the driver takes to react.`,
      `Braking distance went from ${fmtM(r.before.braking)} to ${fmtM(r.after.braking)} because the ${after.surface} road has less grip.`,
    );
  }
  return parts.join(' ');
}
