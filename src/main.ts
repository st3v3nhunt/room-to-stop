import './style.css';
import {
  G,
  HIGHWAY_CODE_REACTION_S,
  SPEEDS_MPH,
  SURFACE_LABEL,
  VEHICLE_LABEL,
  type Surface,
  type Vehicle,
  mphToMs,
  msToMph,
  scoreHazardStop,
  scoreLineStop,
  scoreRunStop,
  RUN_REACTION_BEST_S,
  scorePrediction,
  scoreWhatChanged,
  speedAtDistance,
  stoppingDistance,
  vehicleGrip,
  vehicleStop,
  VEHICLES,
} from './physics';
import { type ChangeLevel, type Scenario, describeChange, describeScenario, pickChange } from './changes';
import type { HazardKind } from './models';
import { LANE_X, World, setSegment } from './world';
import { Sound, type SoundScene } from './sound';
import { renderChangedResults, renderPredictResults, renderResults, type RunResult } from './results';
import { LINE_ROUNDS, MAX_HAZARD_DISTANCE, RUN_LIVES, fastForward, lineRound, multiplier, pickLeg, reactionRating } from './journey';
import { type StopRecord, renderSummary } from './summary';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
const world = new World(canvas, $('labels'));
const sound = new Sound();

const ui = {
  menu: $('menu'),
  results: $('results'),
  hud: $('hud'),
  hudSpeed: $('hud-speed'),
  hudSurface: $('hud-surface'),
  brakeHint: $('brake-hint'),
  message: $('message'),
  flash: $('flash'),
  skip: $<HTMLButtonElement>('skip-replay'),
  baseline: $('baseline'),
  summary: $('summary'),
  jhud: $('jhud'),
  jhudLives: $('jhud-lives'),
  jhudMult: $('jhud-mult'),
  jhudScore: $('jhud-score'),
  hudFf: $('hud-ff'),
  banner: $('banner'),
  stopcard: $('stopcard'),
  lede: $('lede'),
  start: $<HTMLButtonElement>('start'),
  place: $('place'),
  placeBrief: $('place-brief'),
  guessReadout: $('guess-readout'),
  guessSlider: $<HTMLInputElement>('guess-slider'),
  predictHint: $('predict-hint'),
  placeTitle: $('place-title'),
  crossGroup: $('cross-group'),
  crossReadout: $('cross-readout'),
  crossSlider: $<HTMLInputElement>('cross-slider'),
};

// ---------------------------------------------------------------------------
// Settings and menu
// ---------------------------------------------------------------------------

type Mode = 'run' | 'line' | 'hazard' | 'predict' | 'changed';
const MODES: Mode[] = ['run', 'line', 'hazard', 'predict', 'changed'];
const MODE_LABEL: Record<Mode, string> = {
  run: 'Hazard run',
  line: 'Stop on the line',
  hazard: 'Single stop',
  predict: 'Predict the stop',
  changed: 'What changed?',
};
const MODE_LEDE: Record<Mode, string> = {
  run: 'Hazard after hazard, on faster and wetter roads. Brake the moment each one appears. Clean stops build your multiplier, and three mistakes end the run.',
  line: 'A red light ahead. Brake at just the right moment to stop as close to the line as you can without crossing it. Five rounds, from town speeds to ice.',
  hazard: 'One hazard, with the vehicle, road and speed you choose, then a replay of how far you travelled while thinking and braking.',
  predict: 'A driver sees a hazard and brakes. Put a marker on the road where you think the car will stop, then watch it play out.',
  changed:
    'Watch a car stop, then something changes. Predict where it stops now, and how fast it is still going as it passes the old stopping point.',
};
const MODE_START: Record<Mode, string> = {
  run: 'Start the run',
  line: 'Start',
  hazard: 'Drive',
  predict: 'Place your marker',
  changed: 'Watch the first stop',
};

const SURFACES: Surface[] = ['dry', 'wet', 'icy'];
const aVehicle = (v: Vehicle) => `a ${v}`;
const capital = (t: string) => t[0].toUpperCase() + t.slice(1);

const VEHICLE_KINDS: Vehicle[] = ['car', 'motorbike', 'lorry'];
const settings = { surface: 'dry' as Surface, mph: 30, mode: 'run' as Mode, vehicle: 'car' as Vehicle };

function choiceButtons<T extends string | number>(
  root: HTMLElement,
  values: readonly T[],
  label: (v: T) => string,
  get: () => T,
  set: (v: T) => void,
): void {
  root.innerHTML = '';
  for (const v of values) {
    const b = document.createElement('button');
    b.className = 'choice';
    b.type = 'button';
    b.textContent = label(v);
    b.setAttribute('aria-pressed', String(v === get()));
    b.addEventListener('click', () => {
      set(v);
      root.querySelectorAll('button').forEach((x, i) => x.setAttribute('aria-pressed', String(values[i] === v)));
      updateBaseline();
    });
    root.appendChild(b);
  }
}

for (const m of MODES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = m === 'run' ? 'mode-card featured' : 'mode-card';
  b.dataset.mode = m;
  b.innerHTML = `<span class="mode-name">${MODE_LABEL[m]}</span><span class="mode-best"></span>`;
  b.addEventListener('click', () => {
    settings.mode = m;
    updateBaseline();
  });
  $('mode-choices').appendChild(b);
}
choiceButtons($('vehicle-choices'), VEHICLE_KINDS, (v) => VEHICLE_LABEL[v], () => settings.vehicle, (v) => {
  settings.vehicle = v;
  world.setVehicle(v);
});
choiceButtons($('surface-choices'), SURFACES, (s) => SURFACE_LABEL[s], () => settings.surface, (s) => {
  settings.surface = s;
  world.setSurface(s);
  world.buildScenery(7, null);
});
choiceButtons($('speed-choices'), SPEEDS_MPH, (m) => `${m}`, () => settings.mph, (m) => (settings.mph = m));

function updateBaseline(): void {
  const mode = settings.mode;
  const changed = mode === 'changed';
  // Only these two let the player choose the road and speed; the others set their own.
  const pick = mode === 'hazard' || mode === 'predict';
  ui.lede.textContent = MODE_LEDE[mode];
  ui.start.textContent = MODE_START[mode];
  showBest();
  $('surface-field').classList.toggle('hidden', !pick);
  $('speed-field').classList.toggle('hidden', !pick);
  $('vehicle-field').classList.toggle('hidden', changed);
  world.setVehicle(changed ? 'car' : settings.vehicle);
  // In Predict the stop the baseline would give the answer away.
  ui.baseline.classList.toggle('hidden', mode !== 'hazard');
  if (mode !== 'hazard') return;
  const d = vehicleStop(mphToMs(settings.mph), HIGHWAY_CODE_REACTION_S, settings.vehicle, settings.surface);
  ui.baseline.innerHTML =
    `An alert driver ${settings.vehicle === 'motorbike' ? 'on' : 'in'} ${aVehicle(settings.vehicle)} at <strong>${settings.mph} mph</strong> on ${settings.surface === 'icy' ? 'an' : 'a'} <strong>${SURFACE_LABEL[settings.surface].toLowerCase()}</strong> road ` +
    `needs <strong>${Math.round(d.total)} m</strong> to stop: ${Math.round(d.thinking)} m thinking and ${Math.round(d.braking)} m braking.`;
}

const bestKey = (mode: Mode) => (mode === 'hazard' ? 'rts-best' : `rts-best-${mode}`);

function loadBest(mode: Mode = settings.mode): number {
  try {
    return Number(localStorage.getItem(bestKey(mode)) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function saveBest(mode: Mode, score: number): boolean {
  const best = loadBest(mode);
  if (score <= best) return false;
  try {
    localStorage.setItem(bestKey(mode), String(score));
  } catch {
    /* storage unavailable: keep playing */
  }
  return true;
}
function showBest(): void {
  $('mode-choices')
    .querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) => {
      const mode = b.dataset.mode as Mode;
      const best = loadBest(mode);
      b.setAttribute('aria-pressed', String(mode === settings.mode));
      b.querySelector('.mode-best')!.textContent = best > 0 ? `Best ${best.toLocaleString('en-GB')}` : mode === 'run' ? 'New' : '';
    });
}
updateBaseline();

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

type Phase = 'menu' | 'place' | 'drive' | 'halted' | 'replay' | 'results' | 'message';
let phase: Phase = 'menu';

interface Run {
  /** A Hazard run is made of 'run' stops; a Single stop is one 'hazard' stop. */
  mode: Mode;
  /** Stop on the line: road position (m) of the line. */
  lineP: number;
  /** How many times faster than real time the braking plays (long slides in the games of several stops). */
  ff: number;
  vehicle: Vehicle;
  /** Seconds after the brake is pressed before the brakes bite. */
  lag: number;
  surface: Surface;
  mph: number;
  v: number;
  grip: number;
  decel: number;
  ideal: ReturnType<typeof stoppingDistance>;
  /** Null in Predict the stop, where there is no hazard to hit. */
  hazardKind: HazardKind | null;
  /** Road position of the hazard's near edge (Infinity when there is none). */
  hazardP: number;
  /** Planned seconds after the start before the hazard appears. */
  plannedAppearT: number;
  startMs: number;
  appearMs: number | null;
  appearT: number | null;
  brakeT: number | null;
  reaction: number | null;
  endT: number | null;
  hit: boolean;
  impactSpeed: number;
  /** Predict the stop: the player's predicted stopping distance (m) from where the hazard is seen. */
  guess: number;
  /** Whether the brake-press sound has played. */
  brakeHeard?: boolean;
}

/** A What changed? level in progress: the baseline stop plays first, then the changed one. */
interface ChangedState {
  level: ChangeLevel;
  stage: 'before' | 'after';
  seed: number;
  /** Baseline stopping distance (m) from the line. */
  oldTotal: number;
  /** The player's guess at the speed (mph) passing the old stopping point. */
  crossGuess: number;
  /** Real speed (mph) passing the old stopping point. */
  crossActual: number;
  crossLabelShown: boolean;
}
let changed: ChangedState | null = null;

let run: Run | null = null;
let lastFrameMs = performance.now();

function pickHazard(dist: number): HazardKind {
  // Smaller hazards only where they are big enough to see on a phone.
  const options: HazardKind[] = dist <= 75 ? ['child', 'deer', 'car'] : dist <= 120 ? ['deer', 'car'] : ['car'];
  return options[Math.floor(Math.random() * options.length)];
}

const isHazardMode = (m: Mode) => m === 'hazard' || m === 'run';

function startRun(): void {
  window.clearTimeout(journeyTimer);
  journey = null;
  if (settings.mode === 'predict') {
    startPredict();
    return;
  }
  if (settings.mode === 'changed') {
    startChanged();
    return;
  }
  if (settings.mode === 'run' || settings.mode === 'line') {
    startJourney(settings.mode);
    return;
  }
  startHazard({
    mode: 'hazard',
    vehicle: settings.vehicle,
    surface: settings.surface,
    mph: settings.mph,
    margin: 0.12 + Math.random() * 0.25,
    appearT: 3 + Math.random() * 3.5,
  });
}

interface HazardSpec {
  mode: 'hazard' | 'run';
  vehicle: Vehicle;
  surface: Surface;
  mph: number;
  /** Room an alert driver has to spare, as a share of their stopping distance. */
  margin: number;
  /** Seconds of driving before the hazard appears. */
  appearT: number;
}

function startHazard(spec: HazardSpec): void {
  changed = null;
  const v = mphToMs(spec.mph);
  const grip = vehicleGrip(spec.vehicle, spec.surface);
  const ideal = vehicleStop(v, HIGHWAY_CODE_REACTION_S, spec.vehicle, spec.surface);
  const plannedAppearT = spec.appearT;
  // A fair distance: an alert driver stops with a little room to spare.
  const fair = ideal.total * (1 + spec.margin) + 2;
  const dist = Math.min(fair, MAX_HAZARD_DISTANCE);
  const hazardP = v * plannedAppearT + dist;
  const hazardKind = pickHazard(dist);

  world.setSurface(spec.surface);
  world.setVehicle(spec.vehicle);
  world.setStopLine(null);
  world.buildScenery(Math.floor(Math.random() * 1e9), hazardKind === 'car' ? hazardP : null);
  world.placeHazard(hazardKind, hazardP);
  world.clearPaint();
  world.clearLabels();
  world.setGuessMarker(null);
  world.setInset({ right: 0, bottom: 0 });
  world.setSceneryRightVisible(true);

  run = {
    mode: spec.mode,
    lineP: Infinity,
    ff: 1,
    vehicle: spec.vehicle,
    lag: VEHICLES[spec.vehicle].brakeLagS,
    surface: spec.surface,
    mph: spec.mph,
    v,
    grip,
    decel: grip * G,
    ideal,
    hazardKind,
    hazardP,
    plannedAppearT,
    startMs: performance.now(),
    appearMs: null,
    appearT: null,
    brakeT: null,
    reaction: null,
    endT: null,
    hit: false,
    impactSpeed: 0,
    guess: 0,
  };

  // The green strip is explained once; after that it is just there.
  idealLabel = null;
  if (!journey || journey.index === 0) {
    const label = world.addLabel(`Alert driver stops: ${Math.round(ideal.total)} m`, ideal.total, 0.2, 'ideal');
    idealLabel = label;
    window.setTimeout(() => label.style.setProperty('opacity', '0'), 3000);
  }
  showDriveUi(run);
}

/** Show the driving HUD for a run the player brakes in, and start the clock. */
function showDriveUi(r: Run): void {
  hidePanels();
  ui.hud.classList.remove('hidden');
  ui.hudFf.classList.add('hidden');
  ui.brakeHint.classList.remove('hidden');
  ui.hudSurface.textContent = SURFACE_LABEL[r.surface];
  ui.hudSpeed.textContent = String(r.mph);
  (document.activeElement as HTMLElement | null)?.blur();
  audio.speed = r.v;
  audio.braking = false;
  phase = 'drive';
}

// ---------------------------------------------------------------------------
// Hazard run and Stop on the line: several stops in a row, with no menus
// in between. A Hazard run ends when the lives run out; Stop on the line
// is five rounds.
// ---------------------------------------------------------------------------

interface Journey {
  mode: 'run' | 'line';
  vehicle: Vehicle;
  /** Number of the stop being played, from 0. */
  index: number;
  lives: number;
  /** Clean stops in a row. */
  streak: number;
  score: number;
  previousBest: number;
  records: StopRecord[];
}
let journey: Journey | null = null;
let journeyTimer = 0;
let bannerTimer = 0;

function startJourney(mode: 'run' | 'line'): void {
  journey = { mode, vehicle: settings.vehicle, index: 0, lives: RUN_LIVES, streak: 0, score: 0, previousBest: loadBest(mode), records: [] };
  nextLeg();
}

/** Start the stop at journey.index. Also used to retry it after a pause. */
function nextLeg(): void {
  const j = journey;
  if (!j) return;
  ui.stopcard.classList.add('hidden');
  if (j.mode === 'line') {
    startLine(j);
  } else {
    const leg = pickLeg(j.index, j.vehicle, Math.random);
    // The first stop of a stage waits a little longer, so its banner can be read.
    const appearT = (leg.newStage ? 2.6 : 1.5) + Math.random() * 3.4;
    startHazard({ mode: 'run', vehicle: j.vehicle, surface: leg.surface, mph: leg.mph, margin: leg.margin, appearT });
    if (leg.newStage) {
      showBanner(`Stage ${leg.stage + 1}: ${leg.stageName}`, `${leg.mph} mph. ${leg.stageNote}`, 2400);
      if (j.index > 0) sound.jingle('stage');
    } else {
      showBanner(`${leg.mph} mph`, `${SURFACE_LABEL[leg.surface]} road`, 1300, true);
    }
  }
  ui.jhud.classList.remove('hidden');
  showJourneyHud();
}

function startLine(j: Journey): void {
  changed = null;
  const round = lineRound(j.index, j.vehicle, Math.random);
  const v = mphToMs(round.mph);
  const grip = vehicleGrip(j.vehicle, round.surface);
  world.setVehicle(j.vehicle);
  setUpFixedRoad(round.surface, Math.floor(Math.random() * 1e9));
  world.setStopLine(round.lineP);
  world.addLabel('Stop line', round.lineP, 5.6, 'hazard');
  idealLabel = null;
  run = {
    mode: 'line',
    lineP: round.lineP,
    ff: 1,
    vehicle: j.vehicle,
    lag: VEHICLES[j.vehicle].brakeLagS,
    surface: round.surface,
    mph: round.mph,
    v,
    grip,
    decel: grip * G,
    ideal: vehicleStop(v, HIGHWAY_CODE_REACTION_S, j.vehicle, round.surface),
    hazardKind: null,
    hazardP: Infinity,
    plannedAppearT: Infinity,
    startMs: performance.now(),
    appearMs: null,
    appearT: null,
    brakeT: null,
    reaction: null,
    endT: null,
    hit: false,
    impactSpeed: 0,
    guess: 0,
  };
  showDriveUi(run);
  showBanner(`Round ${j.index + 1} of ${LINE_ROUNDS.length}`, `${round.mph} mph, ${SURFACE_LABEL[round.surface].toLowerCase()} road`, 1700);
}

function showBanner(title: string, sub: string, ms: number, small = false): void {
  $('banner-title').textContent = title;
  $('banner-sub').textContent = sub;
  ui.banner.classList.toggle('small', small);
  // Restart the entrance animation.
  ui.banner.classList.add('hidden');
  void ui.banner.offsetWidth;
  ui.banner.classList.remove('hidden');
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => ui.banner.classList.add('hidden'), ms);
}

function showJourneyHud(): void {
  const j = journey;
  if (!j) return;
  const run = j.mode === 'run';
  ui.jhudLives.classList.toggle('hidden', !run);
  ui.jhudLives.innerHTML = '♥'.repeat(j.lives) + `<span class="lost">${'♥'.repeat(RUN_LIVES - j.lives)}</span>`;
  ui.jhudLives.setAttribute('aria-label', `${j.lives} of ${RUN_LIVES} lives`);
  const mult = multiplier(j.streak);
  ui.jhudMult.textContent = run ? `×${mult}` : `Round ${Math.min(j.index + 1, LINE_ROUNDS.length)}/${LINE_ROUNDS.length}`;
  ui.jhudMult.classList.toggle('hot', run && mult > 1);
  ui.jhudScore.textContent = j.score.toLocaleString('en-GB');
}

function showCard(bad: boolean, word: string, big: string, sub: string, points: string): void {
  $('sc-word').textContent = word;
  $('sc-big').textContent = big;
  $('sc-sub').textContent = sub;
  $('sc-points').textContent = points;
  ui.stopcard.classList.toggle('bad', bad);
  ui.banner.classList.add('hidden');
  ui.stopcard.classList.add('hidden');
  void ui.stopcard.offsetWidth;
  ui.stopcard.classList.remove('hidden');
}

/** The vehicle has stopped, hit the hazard or crossed the line: score it and move on. */
function journeyStopDone(early = false): void {
  const j = journey!;
  const r = run!;
  const blank = { mph: r.mph, surface: r.surface, reaction: r.reaction, impactMph: 0, hazardName: hazardName(r.hazardKind), idealGap: 0, multiplier: 1 };
  let rec: StopRecord;
  if (r.mode === 'line') {
    const braking = brakingDistanceOf(r);
    const stopP = motionAt(r, r.endT!).p;
    const gap = r.lineP - stopP;
    const score = scoreLineStop(gap, braking);
    const crossMph = gap < 0 ? msToMph(speedAtPosition(r, r.lineP)) : 0;
    rec = { ...blank, kind: 'line', reaction: null, gap, impactMph: crossMph, braking, base: score.total, points: score.total };
    if (gap < 0) {
      showCard(true, 'Over the line', `${fmtM(-gap)} over`, r.brakeT === null ? 'You did not brake.' : `Still doing ${Math.round(crossMph)} mph at the line.`, '+0');
    } else {
      const word = score.total >= 900 ? 'Spot on' : score.total >= 600 ? 'Close' : 'Plenty of room';
      showCard(false, word, `${fmtM(gap)} short`, `Braking took ${fmtM(braking)} from ${r.mph} mph.`, `+${score.total.toLocaleString('en-GB')}`);
    }
  } else if (early) {
    j.lives--;
    j.streak = 0;
    rec = { ...blank, kind: 'early', reaction: null, gap: 0, braking: 0, base: 0, points: 0 };
    showCard(true, 'Too early', 'No hazard yet', 'Brake only when something moves into your road.', 'Life lost');
  } else {
    const dHazard = r.hazardP - r.v * r.appearT!;
    const actual = r.reaction === null ? null : stoppingDistance(r.v, r.reaction, r.grip, r.lag);
    const idealGap = dHazard - r.ideal.total;
    const gap = r.hit || !actual ? 0 : dHazard - actual.total;
    const braking = brakingDistanceOf(r);
    if (r.hit) {
      j.lives--;
      j.streak = 0;
      const impactMph = msToMph(r.impactSpeed);
      rec = { ...blank, kind: 'hit', gap: 0, impactMph, idealGap, braking, base: 0, points: 0 };
      showCard(
        true,
        `Hit the ${rec.hazardName}`,
        `${Math.round(impactMph)} mph`,
        r.reaction === null
          ? `You did not brake. An alert driver stops ${fmtM(idealGap)} short.`
          : `You reacted in ${r.reaction.toFixed(2)} s. An alert driver stops ${fmtM(idealGap)} short.`,
        'Life lost',
      );
    } else {
      const bestGap = dHazard - stoppingDistance(r.v, RUN_REACTION_BEST_S, r.grip, r.lag).total;
      const base = scoreRunStop(r.reaction!, gap, bestGap);
      const mult = multiplier(j.streak);
      j.streak++;
      rec = { ...blank, kind: 'stop', gap, idealGap, braking, base, multiplier: mult, points: base * mult };
      showCard(
        false,
        reactionRating(r.reaction!),
        `${r.reaction!.toFixed(2)} s`,
        `Stopped ${fmtM(gap)} short of the ${rec.hazardName}.`,
        mult > 1 ? `+${base} ×${mult} = ${rec.points.toLocaleString('en-GB')}` : `+${base}`,
      );
    }
  }
  j.records.push(rec);
  j.score += rec.points;
  showJourneyHud();
  const bad = rec.kind === 'hit' || rec.kind === 'early' || (rec.kind === 'line' && rec.gap < 0);
  sound.jingle(bad ? 'bad' : rec.base >= 800 ? 'great' : 'good');
  const over = j.mode === 'run' ? j.lives <= 0 : j.index + 1 >= LINE_ROUNDS.length;
  window.clearTimeout(journeyTimer);
  journeyTimer = window.setTimeout(() => {
    if (journey !== j) return;
    if (over) {
      endJourney();
    } else {
      j.index++;
      nextLeg();
    }
  }, bad ? 2600 : 1900);
}

/** Distance (m) from pressing the brake to standing still. */
const brakingDistanceOf = (r: Run) => r.v * r.lag + (r.v * r.v) / (2 * r.decel);

function endJourney(): void {
  const j = journey!;
  saveBest(j.mode, j.score);
  ui.stopcard.classList.add('hidden');
  ui.banner.classList.add('hidden');
  ui.jhud.classList.add('hidden');
  ui.hud.classList.add('hidden');
  sound.jingle('over');
  // A run that ended on a hit is shown again from the side before the summary.
  if (canReplay()) startReplay();
  else showSummary();
}

const canReplay = () => !!run && isHazardMode(run.mode) && run.appearT !== null && run.endT !== null;

function showSummary(): void {
  const j = journey!;
  phase = 'results';
  renderSummary({ mode: j.mode, vehicle: j.vehicle, score: j.score, previousBest: j.previousBest, records: j.records, canReplay: canReplay() });
  revealPanel(ui.summary, 'sum-again');
}

let idealLabel: HTMLDivElement | null = null;

/** Exact position (m) and speed (m/s) of the car's front bumper at time t (s) into the run. */
function motionAt(r: Run, t: number): { p: number; speed: number } {
  // Full speed until the brakes bite: the brake is pressed at brakeT, then any lag.
  if (r.brakeT === null || t <= r.brakeT + r.lag) return { p: r.v * t, speed: r.v };
  const pB = r.v * (r.brakeT + r.lag);
  const tau = t - r.brakeT - r.lag;
  const tStop = r.v / r.decel;
  if (tau >= tStop) return { p: pB + (r.v * r.v) / (2 * r.decel), speed: 0 };
  return { p: pB + r.v * tau - 0.5 * r.decel * tau * tau, speed: r.v - r.decel * tau };
}

function onBrake(timeStamp: number): void {
  if (phase !== 'drive' || !run || run.brakeT !== null) return;
  if (run.mode === 'line') {
    // The player chooses the moment: there is nothing to react to.
    run.brakeT = Math.max(0, (timeStamp - run.startMs) / 1000);
    run.ff = fastForward(run.v, run.grip);
    world.kick(0.12);
    return;
  }
  if (!isHazardMode(run.mode)) return;
  // Between stops, a tap meant for the last one should not count against this one.
  if (journey && timeStamp - run.startMs < 400) return;
  if (run.appearMs === null || run.appearT === null) {
    falseStart('You braked before anything appeared. Brake only when you see a hazard.');
    return;
  }
  const reaction = (timeStamp - run.appearMs) / 1000;
  if (reaction < 0.1) {
    falseStart('That was quicker than anyone can react, so it counts as a guess. Wait until you see the hazard.');
    return;
  }
  run.reaction = reaction;
  run.brakeT = run.appearT + reaction;
  if (journey) run.ff = fastForward(run.v, run.grip);
  world.kick(0.12);
}

function falseStart(text: string): void {
  ui.brakeHint.classList.add('hidden');
  if (journey) {
    phase = 'halted';
    journeyStopDone(true);
    return;
  }
  phase = 'message';
  showMessage('False start', text, [
    { label: 'Try again', primary: true, action: startRun },
    { label: 'Menu', action: showMenu },
  ]);
}

function showMessage(title: string, text: string, buttons: { label: string; primary?: boolean; action: () => void }[]): void {
  ui.message.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('div');
  p.textContent = text;
  ui.message.append(strong, p);
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.justifyContent = 'center';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    if (b.primary) btn.className = 'primary';
    btn.style.width = 'auto';
    btn.addEventListener('click', b.action);
    row.appendChild(btn);
  }
  ui.message.appendChild(row);
  ui.message.classList.remove('hidden');
  (row.querySelector('button.primary') as HTMLButtonElement | null)?.focus();
}

function showMenu(): void {
  phase = 'menu';
  run = null;
  changed = null;
  journey = null;
  window.clearTimeout(journeyTimer);
  window.clearTimeout(bannerTimer);
  world.setStopLine(null);
  ui.summary.classList.add('hidden');
  ui.jhud.classList.add('hidden');
  ui.banner.classList.add('hidden');
  ui.stopcard.classList.add('hidden');
  world.clearLabels();
  world.clearPaint();
  world.clearHazard();
  world.setIdealMarker(null);
  world.setGuessMarker(null);
  world.resize();
  world.setInset({ right: 0, bottom: 0 });
  world.setSceneryRightVisible(true);
  ui.results.classList.add('hidden');
  ui.message.classList.add('hidden');
  ui.place.classList.add('hidden');
  ui.predictHint.classList.add('hidden');
  ui.hud.classList.add('hidden');
  ui.brakeHint.classList.add('hidden');
  ui.skip.classList.add('hidden');
  ui.menu.classList.remove('hidden');
  updateBaseline();
}

// ---------------------------------------------------------------------------
// Input: read directly from browser events so reaction times are fair.
// ---------------------------------------------------------------------------

window.addEventListener(
  'keydown',
  (e) => {
    if (phase === 'place') {
      onPlaceKey(e);
      return;
    }
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (phase === 'drive') {
      e.preventDefault();
      if (!e.repeat) onBrake(e.timeStamp);
    }
  },
  { capture: true },
);

canvas.addEventListener('pointerdown', (e) => {
  if (phase === 'drive') {
    e.preventDefault();
    onBrake(e.timeStamp);
  } else if (phase === 'place') {
    e.preventDefault();
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    guessFromPointer(e);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (phase === 'place' && dragging) guessFromPointer(e);
});
const endDrag = () => (dragging = false);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

document.addEventListener('visibilitychange', () => {
  // Predict the stop plays out on its own, so only the hazard stop needs pausing.
  if (document.hidden && phase === 'drive' && run && run.mode !== 'predict' && run.mode !== 'changed') {
    phase = 'message';
    ui.brakeHint.classList.add('hidden');
    ui.banner.classList.add('hidden');
    showMessage('Paused', `The game was hidden during the drive, so that ${journey ? 'stop' : 'run'} does not count.`, [
      { label: journey ? 'Carry on' : 'Try again', primary: true, action: journey ? nextLeg : startRun },
      { label: 'Menu', action: showMenu },
    ]);
  }
});

$('start').addEventListener('click', startRun);
$('again').addEventListener('click', startRun);
$('change').addEventListener('click', showMenu);
$('sum-again').addEventListener('click', startRun);
$('sum-menu').addEventListener('click', showMenu);
$('sum-replay').addEventListener('click', () => startReplay());
$('replay').addEventListener('click', () => startReplay());
ui.skip.addEventListener('click', () => finishReplay());
window.addEventListener('resize', () => {
  world.resize();
  if (phase === 'place') framePlace();
});

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

function updateDrive(nowMs: number, dt: number): void {
  const r = run!;
  const real = (nowMs - r.startMs) / 1000;
  // Long slides play faster than real time once the brake is pressed.
  const t = r.ff > 1 && r.brakeT !== null && real > r.brakeT ? r.brakeT + (real - r.brakeT) * r.ff : real;
  let { p, speed } = motionAt(r, t);

  // Hazard appears on the first frame at or after its planned time.
  let justAppeared = false;
  if (isHazardMode(r.mode) && r.appearMs === null && t >= r.plannedAppearT) justAppeared = true;

  if (p >= r.hazardP && r.appearT !== null) {
    // The car reached the hazard while still moving: sudden halt.
    r.hit = true;
    r.impactSpeed = speedAtPosition(r, r.hazardP);
    p = r.hazardP;
    speed = 0;
    r.endT = timeAtPosition(r, r.hazardP);
    halt(true);
  } else if (speed === 0 && r.brakeT !== null) {
    r.endT = r.brakeT + r.lag + r.v / r.decel;
    halt(false);
  } else if (r.mode === 'line' && r.brakeT === null && p >= r.lineP + 8) {
    // Straight through the red light without braking.
    r.endT = t;
    halt(false);
  }
  const fast = r.ff > 1 && r.brakeT !== null && t > r.brakeT && phase === 'drive';
  ui.hudFf.classList.toggle('hidden', !fast);
  if (fast) ui.hudFf.textContent = `▶▶ ${r.ff.toFixed(1)}×`;

  world.setCar(p, speed, r.brakeT !== null && t >= r.brakeT, dt);
  if (r.brakeT !== null && t >= r.brakeT && !r.brakeHeard) {
    r.brakeHeard = true;
    sound.brakePressed();
  }
  audio.speed = speed;
  audio.braking = r.brakeT !== null && t >= r.brakeT + r.lag;
  world.updateHazard(r.appearT === null ? (justAppeared ? 0 : -1) : t - r.appearT);
  // The faint ideal marker shows where an alert driver would stop if a hazard
  // appeared now. Once the hazard appears it stays where they would stop.
  if (isHazardMode(r.mode)) {
    const markerP = r.appearT === null ? p + r.ideal.total : r.v * r.appearT + r.ideal.total;
    world.setIdealMarker(markerP);
    if (idealLabel) world.moveLabel(idealLabel, markerP);
  }
  world.chaseCamera(p, speed, t);
  ui.hudSpeed.textContent = String(Math.round(msToMph(speed)));

  world.render(dt);

  if (justAppeared) {
    // Measured after the frame that shows the hazard has been drawn.
    r.appearMs = performance.now();
    r.appearT = (r.appearMs - r.startMs) / 1000;
  }
}

function speedAtPosition(r: Run, pos: number): number {
  if (r.brakeT === null) return r.v;
  const pB = r.v * (r.brakeT + r.lag);
  if (pos <= pB) return r.v;
  const v2 = r.v * r.v - 2 * r.decel * (pos - pB);
  return v2 > 0 ? Math.sqrt(v2) : 0;
}

function timeAtPosition(r: Run, pos: number): number {
  if (r.brakeT === null) return pos / r.v;
  const pB = r.v * (r.brakeT + r.lag);
  if (pos <= pB) return pos / r.v;
  const vAt = speedAtPosition(r, pos);
  return r.brakeT + r.lag + (r.v - vAt) / r.decel;
}

function halt(hit: boolean): void {
  phase = 'halted';
  ui.brakeHint.classList.add('hidden');
  ui.predictHint.classList.add('hidden');
  if (hit) {
    sound.impact();
    ui.flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => ui.flash.classList.remove('on')));
  }
  if (journey) {
    journeyStopDone();
    return;
  }
  window.setTimeout(() => {
    if (phase === 'halted' && !journey) startReplay();
  }, hit ? 1100 : 900);
}

// ---------------------------------------------------------------------------
// Side-on replay with distances painted on the road
// ---------------------------------------------------------------------------

interface Replay {
  startMs: number;
  t0: number;
  t1: number;
  rate: number;
  appearP: number;
  brakeP: number | null;
  stopP: number;
  think: THREE_Mesh;
  brake: THREE_Mesh | null;
}
type THREE_Mesh = ReturnType<World['paintSegment']>;

let replay: Replay | null = null;

function startReplay(): void {
  const r = run;
  if (!r || r.appearT === null || r.endT === null) return;
  phase = 'replay';
  ui.results.classList.add('hidden');
  ui.summary.classList.add('hidden');
  ui.hud.classList.add('hidden');
  ui.skip.classList.remove('hidden');
  world.clearPaint();
  world.clearLabels();
  idealLabel = null;
  world.setInset({ right: 0, bottom: 0 });
  world.setSceneryRightVisible(false);

  const appearP = r.v * r.appearT;
  const brakeP = r.brakeT === null ? null : Math.min(r.v * r.brakeT, r.hazardP);
  const stopP = motionAt(r, r.endT).p;
  const idealStop = appearP + r.ideal.total;
  const predict = r.mode === 'predict';
  const guessP = appearP + r.guess;

  const placed = !isHazardMode(r.mode);
  // What changed?: the second stop is shown against where the first one ended.
  const oldStopP = changed?.stage === 'after' ? appearP + changed.oldTotal : null;
  const hasGuess = predict || oldStopP !== null;

  const frameEnd = hasGuess
    ? Math.max(stopP, guessP) + 3
    : placed
      ? stopP + 3
      : Math.max(r.hazardP + 3, idealStop <= r.hazardP + 30 ? idealStop + 2 : 0);
  replayFrame = [appearP - 8, frameEnd + 4];
  world.sideCamera(replayFrame[0], replayFrame[1]);
  world.setIdealMarker(placed ? oldStopP : idealStop);
  world.setGuessMarker(null);

  const think = world.paintSegment(appearP, appearP, 0xf2b632);
  const brake = brakeP === null ? null : world.paintSegment(brakeP, brakeP, 0xe0483e);
  world.addLabel(placed ? 'Driver sees hazard' : 'Hazard appears', appearP, 3.4, 'hazard');
  if (hasGuess) world.addLabel(`Your guess (${fmtM(r.guess)})`, guessP, 4.6, 'guess', -4.6);
  if (oldStopP !== null) world.addLabel(`Stopped before (${fmtM(changed!.oldTotal)})`, oldStopP, 3.4, 'ideal');
  else if (!placed && idealStop <= frameEnd + 4) world.addLabel(`Alert driver stops (${Math.round(r.ideal.total)} m)`, idealStop, 4.6, 'ideal', -4.6);

  const t0 = Math.max(0, r.appearT - 1);
  const t1 = r.endT + 0.4;
  const duration = t1 - t0;
  replay = {
    startMs: performance.now(),
    t0,
    t1,
    rate: Math.max(1, duration / 7),
    appearP,
    brakeP,
    stopP,
    think,
    brake,
  };
  replayLabelsShown = { brake: false, stop: false };
  if (changed) changed.crossLabelShown = false;
}

/** What changed?: label the speed as the car passes where it stopped before. */
function showCrossLabel(): void {
  if (!run || changed?.stage !== 'after' || changed.crossLabelShown) return;
  changed.crossLabelShown = true;
  const oldStopP = run.v * run.appearT! + changed.oldTotal;
  world.addLabel(`Passing at ${Math.round(changed.crossActual)} mph`, oldStopP, 1.6, 'brake', LANE_X + 4.2);
}

let replayLabelsShown = { brake: false, stop: false };
let replayFrame: [number, number] = [0, 0];
/** Long stops are followed by the camera, then shown whole at the end. */
const FOLLOW_WINDOW = 70;

function updateReplay(nowMs: number, dt: number): void {
  const r = run!;
  const rp = replay!;
  const t = Math.min(rp.t1, rp.t0 + ((nowMs - rp.startMs) / 1000) * rp.rate);
  const { p: rawP } = motionAt(r, t);
  const p = Math.min(rawP, r.hit ? r.hazardP : rawP);
  const braking = r.brakeT !== null && t >= r.brakeT;
  world.setCar(p, braking ? 1 : r.v, braking, dt);
  world.updateHazard(t - r.appearT!);

  // Grow the painted thinking and braking distances behind the car.
  const thinkEnd = rp.brakeP ?? r.hazardP;
  if (p > rp.appearP) setSegment(rp.think, rp.appearP, Math.min(p, thinkEnd) - rp.appearP);
  if (rp.brake && rp.brakeP !== null && p > rp.brakeP) setSegment(rp.brake, rp.brakeP, p - rp.brakeP);

  if (!replayLabelsShown.brake && rp.brakeP !== null && p >= rp.brakeP) {
    replayLabelsShown.brake = true;
    world.addLabel(`Thinking ${fmtM(rp.brakeP - rp.appearP)}`, (rp.appearP + rp.brakeP) / 2, 1.6, 'think');
  }
  if (changed?.stage === 'after' && p >= rp.appearP + changed.oldTotal) showCrossLabel();
  if (!replayLabelsShown.stop && t >= rp.t1 - 0.4 / rp.rate - 0.001) {
    replayLabelsShown.stop = true;
    if (rp.brakeP !== null && rp.stopP > rp.brakeP + 0.5) {
      world.addLabel(`Braking ${fmtM(rp.stopP - rp.brakeP)}`, (rp.brakeP + rp.stopP) / 2, 1.6, 'brake');
    }
    world.addLabel(r.hit ? `Hit at ${Math.round(msToMph(r.impactSpeed))} mph` : `Stopped: ${fmtM(rp.stopP - rp.appearP)}`, rp.stopP, 2.6, r.hit ? 'brake' : 'think');
  }

  const [fa, fb] = replayFrame;
  if (fb - fa > FOLLOW_WINDOW * 1.2) {
    const a = Math.max(fa, Math.min(p - FOLLOW_WINDOW * 0.6, fb - FOLLOW_WINDOW));
    world.sideCamera(a, a + FOLLOW_WINDOW);
  }
  world.render(dt);
  if (t >= rp.t1) finishReplay(800);
}

let finishTimer = 0;
function finishReplay(delay = 0): void {
  if (phase !== 'replay') return;
  phase = 'results';
  window.clearTimeout(finishTimer);
  const r = run!;
  const rp = replay!;
  // Jump to the end state in case the replay was skipped.
  const endP = r.hit ? r.hazardP : rp.stopP;
  world.setCar(endP, 0, r.brakeT !== null, 1);
  world.updateHazard(r.endT! - r.appearT! + 5);
  setSegment(rp.think, rp.appearP, (rp.brakeP ?? r.hazardP) - rp.appearP);
  if (rp.brake && rp.brakeP !== null) setSegment(rp.brake, rp.brakeP, endP - rp.brakeP);
  if (!replayLabelsShown.stop) {
    replayLabelsShown.stop = true;
    replayLabelsShown.brake = true;
    if (rp.brakeP !== null) world.addLabel(`Thinking ${fmtM(rp.brakeP - rp.appearP)}`, (rp.appearP + rp.brakeP) / 2, 1.6, 'think');
    if (rp.brakeP !== null && rp.stopP > rp.brakeP + 0.5) world.addLabel(`Braking ${fmtM(rp.stopP - rp.brakeP)}`, (rp.brakeP + rp.stopP) / 2, 1.6, 'brake');
    world.addLabel(r.hit ? `Hit at ${Math.round(msToMph(r.impactSpeed))} mph` : `Stopped: ${fmtM(rp.stopP - rp.appearP)}`, rp.stopP, 2.6, r.hit ? 'brake' : 'think');
  }
  showCrossLabel();
  world.sideCamera(replayFrame[0], replayFrame[1]);
  ui.skip.classList.add('hidden');
  finishTimer = window.setTimeout(showResults, delay);
}

function showResults(): void {
  const r = run!;
  if (journey) {
    showSummary();
    return;
  }
  if (r.mode === 'predict') {
    showPredictResults(r);
    return;
  }
  if (r.mode === 'changed') {
    if (changed?.stage === 'before') placeChanged();
    else showChangedResults(r);
    return;
  }
  const appearP = r.v * r.appearT!;
  const dHazard = r.hazardP - appearP;
  const reaction = r.reaction;
  const actual = reaction === null ? null : stoppingDistance(r.v, reaction, r.grip, r.lag);
  const idealGap = dHazard - r.ideal.total;
  const gap = r.hit || !actual ? 0 : dHazard - actual.total;
  const score = scoreHazardStop(reaction ?? 99, r.hit, gap, idealGap);
  const isBest = saveBest('hazard', score.total);

  const result: RunResult = {
    vehicle: r.vehicle,
    surface: r.surface,
    mph: r.mph,
    grip: r.grip,
    reaction,
    hazardName: hazardName(r.hazardKind),
    hazardDistance: dHazard,
    actual,
    ideal: r.ideal,
    hit: r.hit,
    impactMph: msToMph(r.impactSpeed),
    gap,
    score,
    isBest,
  };
  renderResults(result);
  revealResults();
}

const revealResults = () => revealPanel(ui.results, 'again');

function revealPanel(panel: HTMLElement, focusId: string): void {
  panel.classList.remove('hidden');
  panel.scrollTop = 0;

  // Keep the painted road visible beside or above the results panel.
  const rect = panel.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const onRight = rect.left > W * 0.3;
  world.setInset(onRight ? { right: W - rect.left + 8, bottom: 0 } : { right: 0, bottom: Math.min(H * 0.6, H - rect.top + 8) });
  if (!onRight) world.setLabelClip(H - rect.top + 8);
  world.reframeSide();
  ($(focusId) as HTMLButtonElement).focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Predict the stop: the player places a marker, then the stop plays out with
// the Highway Code reaction time and no input from them.
// ---------------------------------------------------------------------------

/** Seconds of driving before the driver sees the hazard. */
const PREDICT_RUN_UP_S = 2.5;
/** Longest prediction allowed (m): more than the 777 m a car needs at 70 mph on ice. */
const MAX_GUESS = 800;
const START_GUESS = 40;
const SLIDER_MAX = 1000;
let dragging = false;
let guessLabel: HTMLDivElement | null = null;

// The slider is on a square-root scale, so short stops can be set finely and long icy ones still fit.
const guessToSlider = (g: number) => Math.round(Math.sqrt(g / MAX_GUESS) * SLIDER_MAX);
const sliderToGuess = (s: number) => MAX_GUESS * (s / SLIDER_MAX) ** 2;

/**
 * A run whose whole stop is fixed in advance: the driver sees the hazard at
 * road position lineP and brakes 0.67 s later, with no input from the player.
 */
function fixedRun(mode: Mode, sc: Scenario, lineP: number): Run {
  const v = mphToMs(sc.mph);
  const grip = vehicleGrip(sc.vehicle, sc.surface);
  const appearT = lineP / v;
  world.setVehicle(sc.vehicle);
  return {
    mode,
    lineP: Infinity,
    ff: 1,
    vehicle: sc.vehicle,
    lag: VEHICLES[sc.vehicle].brakeLagS,
    surface: sc.surface,
    mph: sc.mph,
    v,
    grip,
    decel: grip * G,
    ideal: vehicleStop(v, HIGHWAY_CODE_REACTION_S, sc.vehicle, sc.surface),
    hazardKind: null,
    hazardP: Infinity,
    plannedAppearT: appearT,
    startMs: 0,
    appearMs: null,
    appearT,
    brakeT: appearT + HIGHWAY_CODE_REACTION_S,
    reaction: HIGHWAY_CODE_REACTION_S,
    endT: null,
    hit: false,
    impactSpeed: 0,
    guess: START_GUESS,
  };
}

/** Road position (m) of the line where the driver sees the hazard. */
const lineOf = (r: Run) => r.v * (r.appearT ?? 0);

/** Reset the world for a run with no hazard, painting the line where the driver sees one. */
function setUpFixedRoad(surface: Surface, seed: number): void {
  world.setSurface(surface);
  world.setStopLine(null);
  world.buildScenery(seed, null);
  world.clearHazard();
  world.clearPaint();
  world.clearLabels();
  world.setIdealMarker(null);
  world.setGuessMarker(null);
  world.resize();
  world.setInset({ right: 0, bottom: 0 });
  world.setSceneryRightVisible(true);
}

function hidePanels(): void {
  ui.menu.classList.add('hidden');
  ui.results.classList.add('hidden');
  ui.summary.classList.add('hidden');
  ui.message.classList.add('hidden');
  ui.brakeHint.classList.add('hidden');
  ui.predictHint.classList.add('hidden');
  ui.place.classList.add('hidden');
}

function startPredict(): void {
  changed = null;
  setUpFixedRoad(settings.surface, Math.floor(Math.random() * 1e9));
  run = fixedRun('predict', settings, mphToMs(settings.mph) * PREDICT_RUN_UP_S);
  idealLabel = null;
  ui.placeTitle.textContent = 'Where will it stop?';
  ui.crossGroup.classList.add('hidden');
  ui.placeBrief.innerHTML =
    `${capital(aVehicle(run.vehicle))} doing <strong>${run.mph} mph</strong> on ${run.surface === 'icy' ? 'an' : 'a'} <strong>${SURFACE_LABEL[run.surface].toLowerCase()}</strong> road. ` +
    `The driver sees a hazard at the white line, reacts in ${HIGHWAY_CODE_REACTION_S} s, then brakes as hard as they can.`;
  beginPlacing(START_GUESS);
}

/** Park the car at the line and let the player place their marker. */
function beginPlacing(startGuess: number): void {
  const r = run!;
  const lineP = lineOf(r);
  world.paintSegment(lineP - 0.35, lineP, 0xffffff, 0.95);
  world.addLabel('Driver sees hazard', lineP, 2.2, 'hazard');
  guessLabel = world.addLabel('', lineP + startGuess, 1.2, 'guess');
  world.setCar(lineP, 0, false, 1);
  setGuess(startGuess);

  hidePanels();
  ui.skip.classList.add('hidden');
  ui.place.classList.remove('hidden');
  ui.hud.classList.remove('hidden');
  ui.hudSurface.textContent = SURFACE_LABEL[r.surface];
  ui.hudSpeed.textContent = String(r.mph);
  phase = 'place';
  framePlace();
  ui.guessSlider.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// What changed?: a baseline stop plays out, then one or more variables
// change and the player predicts the new stop and the speed at the old one.
// ---------------------------------------------------------------------------

/** Where the driver sees the hazard in What changed?, the same for both stops. */
const CHANGED_LINE_P = 40;

function startChanged(): void {
  const level = pickChange(Math.random);
  const { vehicle: av, mph: amph, surface: as } = level.after;
  const before = vehicleStop(mphToMs(level.before.mph), HIGHWAY_CODE_REACTION_S, level.before.vehicle, level.before.surface);
  changed = {
    level,
    stage: 'before',
    seed: Math.floor(Math.random() * 1e9),
    oldTotal: before.total,
    crossGuess: 0,
    crossActual: msToMph(
      speedAtDistance(mphToMs(amph), HIGHWAY_CODE_REACTION_S, vehicleGrip(av, as), before.total, VEHICLES[av].brakeLagS),
    ),
    crossLabelShown: false,
  };
  setUpFixedRoad(level.before.surface, changed.seed);
  run = fixedRun('changed', level.before, CHANGED_LINE_P);
  run.endT = run.brakeT! + run.lag + run.v / run.decel;
  idealLabel = null;
  hidePanels();
  ui.hud.classList.add('hidden');
  ui.predictHint.textContent = `First: ${describeScenario(level.before)}`;
  ui.predictHint.classList.remove('hidden');
  (document.activeElement as HTMLElement | null)?.blur();
  // The baseline is shown straight away as a side-on replay.
  startReplay();
}

/** After the baseline: change the variables and ask for both predictions. */
function placeChanged(): void {
  const c = changed!;
  c.stage = 'after';
  const { after } = c.level;
  setUpFixedRoad(after.surface, c.seed);
  run = fixedRun('changed', after, CHANGED_LINE_P);
  idealLabel = null;
  const oldStopP = CHANGED_LINE_P + c.oldTotal;
  world.setIdealMarker(oldStopP);
  world.addLabel(`Stopped before: ${fmtM(c.oldTotal)}`, oldStopP, 2.4, 'ideal', LANE_X + 4.2);

  ui.placeTitle.textContent = 'Where will it stop now?';
  ui.placeBrief.innerHTML =
    `Now: ${describeChange(c.level)}. The same driver reacts in ${HIGHWAY_CODE_REACTION_S} s. ` +
    `Where will it stop, and how fast will it still be going as it passes the green line where it stopped before?`;
  ui.crossGroup.classList.remove('hidden');
  ui.crossSlider.max = String(after.mph);
  setCross(Math.round(after.mph / 2));
  // Start the marker at the old stopping point.
  beginPlacing(c.oldTotal);
}

function setCross(mph: number): void {
  if (!changed || !run) return;
  const v = Math.max(0, Math.min(run.mph, Math.round(mph)));
  changed.crossGuess = v;
  ui.crossSlider.value = String(v);
  ui.crossReadout.textContent = `${v} mph`;
  ui.crossSlider.setAttribute('aria-valuetext', `${v} mph`);
}

ui.crossSlider.addEventListener('input', () => setCross(Number(ui.crossSlider.value)));
$('cross-less').addEventListener('click', () => changed && setCross(changed.crossGuess - 1));
$('cross-more').addEventListener('click', () => changed && setCross(changed.crossGuess + 1));

function showChangedResults(r: Run): void {
  const c = changed!;
  const { before } = c.level;
  const beforeStop = vehicleStop(mphToMs(before.mph), HIGHWAY_CODE_REACTION_S, before.vehicle, before.surface);
  const score = scoreWhatChanged(r.guess, r.ideal.total, c.crossGuess, c.crossActual);
  const isBest = saveBest('changed', score.total);
  renderChangedResults({
    level: c.level,
    before: beforeStop,
    after: r.ideal,
    guess: r.guess,
    crossGuess: c.crossGuess,
    crossActual: c.crossActual,
    score,
    isBest,
  });
  revealResults();
}

/** Keep the road clear of the placing panel: frame the shot in the space above it. */
function framePlace(): void {
  if (!run) return;
  const rect = ui.place.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  // In landscape on a phone the panel sits on the right, so frame the road to its left.
  const onRight = rect.left > W * 0.3;
  world.placeCamera(lineOf(run), onRight ? rect.left - 8 : W, onRight ? H : rect.top - 8);
}

function setGuess(g: number, fromSlider = false): void {
  if (!run) return;
  const guess = Math.min(MAX_GUESS, Math.max(1, Math.round(g * 2) / 2));
  run.guess = guess;
  const p = lineOf(run) + guess;
  world.setGuessMarker(p);
  if (guessLabel) {
    guessLabel.textContent = `Your guess: ${fmtM(guess)}`;
    world.moveLabel(guessLabel, p);
  }
  ui.guessReadout.textContent = fmtM(guess);
  if (!fromSlider) ui.guessSlider.value = String(guessToSlider(guess));
  ui.guessSlider.setAttribute('aria-valuetext', `${fmtM(guess)}`);
}

function guessFromPointer(e: PointerEvent): void {
  if (!run) return;
  const p = world.roadPositionAt(e.clientX, e.clientY);
  // Above the horizon counts as as far as the marker can go.
  setGuess(p === null ? MAX_GUESS : p - lineOf(run));
}

function nudgeGuess(metres: number): void {
  if (run) setGuess(run.guess + metres);
}

function onPlaceKey(e: KeyboardEvent): void {
  const step = e.shiftKey ? 10 : 1;
  if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') {
    e.preventDefault();
    lockIn();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    showMenu();
  } else if (document.activeElement !== ui.guessSlider && (e.key === 'ArrowUp' || e.key === 'ArrowRight')) {
    e.preventDefault();
    nudgeGuess(step);
  } else if (document.activeElement !== ui.guessSlider && (e.key === 'ArrowDown' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    nudgeGuess(-step);
  }
}

ui.guessSlider.max = String(SLIDER_MAX);
ui.guessSlider.addEventListener('input', () => setGuess(sliderToGuess(Number(ui.guessSlider.value)), true));
$('guess-less').addEventListener('click', () => nudgeGuess(-1));
$('guess-more').addEventListener('click', () => nudgeGuess(1));
$('place-back').addEventListener('click', showMenu);
$('place-go').addEventListener('click', () => lockIn());

function lockIn(): void {
  if (phase !== 'place' || !run) return;
  dragging = false;
  ui.place.classList.add('hidden');
  ui.predictHint.textContent = `Watch: the driver reacts in ${HIGHWAY_CODE_REACTION_S} s, then brakes hard`;
  ui.predictHint.classList.remove('hidden');
  world.resize(); // undo the placing camera's framing
  world.setInset({ right: 0, bottom: 0 });
  (document.activeElement as HTMLElement | null)?.blur();
  run.startMs = performance.now();
  phase = 'drive';
}

function showPredictResults(r: Run): void {
  const actual = r.ideal;
  const score = scorePrediction(r.guess, actual.total);
  const isBest = saveBest('predict', score.total);
  renderPredictResults({ vehicle: r.vehicle, surface: r.surface, mph: r.mph, guess: r.guess, actual, score, isBest });
  revealResults();
}

function hazardName(k: HazardKind | null): string {
  return k === 'child' ? 'child' : k === 'deer' ? 'deer' : 'car pulling out';
}

function fmtM(m: number): string {
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

/** What the drive sounds should follow, updated each driving frame. */
const audio = { speed: 0, braking: false };
const SCENE: Partial<Record<Phase, SoundScene>> = { menu: 'menu', place: 'idle', drive: 'drive' };

let idleT = 0;
function frame(nowMs: number): void {
  const dt = Math.min(0.1, (nowMs - lastFrameMs) / 1000);
  lastFrameMs = nowMs;
  if (phase === 'drive' && run) {
    updateDrive(nowMs, dt);
  } else if (phase === 'replay' && run && replay) {
    updateReplay(nowMs, dt);
  } else if (phase === 'menu') {
    // Gentle attract loop behind the menu.
    idleT += dt;
    const p = (idleT * 13) % 600;
    world.setIdealMarker(null);
    world.setCar(p, 13, false, dt);
    world.chaseCamera(p, 13, idleT);
    world.render(dt);
  } else {
    world.render(dt);
  }
  sound.setVehicle(run?.vehicle ?? (settings.mode === 'changed' ? 'car' : settings.vehicle));
  sound.update(SCENE[phase] ?? 'quiet', run?.surface ?? settings.surface, audio.speed, audio.braking);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Sound: browsers only allow audio after the player touches the page.
// ---------------------------------------------------------------------------

const muteBtn = $<HTMLButtonElement>('mute');
function showMute(): void {
  muteBtn.setAttribute('aria-pressed', String(sound.isMuted));
  muteBtn.setAttribute('aria-label', sound.isMuted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off');
  muteBtn.classList.toggle('muted', sound.isMuted);
}
showMute();
const unlockAudio = () => sound.unlock();
window.addEventListener('pointerdown', unlockAudio, { capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });
muteBtn.addEventListener('click', () => {
  sound.unlock();
  sound.setMuted(!sound.isMuted);
  showMute();
  muteBtn.blur();
});
// Keep a tap on the mute button from also counting as a brake.
muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());

// Read-only hook for automated play-testing.
(window as unknown as { __rts: () => object }).__rts = () => ({
  phase,
  hazardVisible: run?.appearMs != null,
  hazardKind: run?.hazardKind,
  mode: run?.mode,
  journey: journey && { mode: journey.mode, index: journey.index, lives: journey.lives, streak: journey.streak, score: journey.score },
  lineP: run?.lineP,
  braking: run ? brakingDistanceOf(run) : undefined,
  carP: run && phase === 'drive' ? run.v * ((performance.now() - run.startMs) / 1000) : undefined,
  guess: run?.guess,
  changedStage: changed?.stage,
  crossActual: changed?.crossActual,
  sound: sound.debug(),
  stoppingDistance: run?.ideal.total,
});
