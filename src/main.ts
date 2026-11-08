import './style.css';
import {
  G,
  HIGHWAY_CODE_REACTION_S,
  SPEEDS_MPH,
  SURFACE_GRIP,
  SURFACE_LABEL,
  type Surface,
  mphToMs,
  msToMph,
  scoreHazardStop,
  stoppingDistance,
} from './physics';
import type { HazardKind } from './models';
import { World, setSegment } from './world';
import { renderResults, type RunResult } from './results';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
const world = new World(canvas, $('labels'));

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
  best: $('best'),
};

// ---------------------------------------------------------------------------
// Settings and menu
// ---------------------------------------------------------------------------

const SURFACES: Surface[] = ['dry', 'wet', 'icy'];
const settings = { surface: 'dry' as Surface, mph: 30 };

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

choiceButtons($('surface-choices'), SURFACES, (s) => SURFACE_LABEL[s], () => settings.surface, (s) => {
  settings.surface = s;
  world.setSurface(s);
  world.buildScenery(7, null);
});
choiceButtons($('speed-choices'), SPEEDS_MPH, (m) => `${m}`, () => settings.mph, (m) => (settings.mph = m));

function updateBaseline(): void {
  const d = stoppingDistance(mphToMs(settings.mph), HIGHWAY_CODE_REACTION_S, SURFACE_GRIP[settings.surface]);
  ui.baseline.innerHTML =
    `An alert driver at <strong>${settings.mph} mph</strong> on a <strong>${SURFACE_LABEL[settings.surface].toLowerCase()}</strong> road ` +
    `needs <strong>${Math.round(d.total)} m</strong> to stop: ${Math.round(d.thinking)} m thinking and ${Math.round(d.braking)} m braking.`;
}
updateBaseline();

function loadBest(): number {
  try {
    return Number(localStorage.getItem('rts-best') ?? 0) || 0;
  } catch {
    return 0;
  }
}
function saveBest(score: number): boolean {
  const best = loadBest();
  if (score <= best) return false;
  try {
    localStorage.setItem('rts-best', String(score));
  } catch {
    /* storage unavailable: keep playing */
  }
  return true;
}
function showBest(): void {
  const b = loadBest();
  ui.best.textContent = b > 0 ? `Your best score: ${b} / 1,000` : '';
}
showBest();

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

type Phase = 'menu' | 'drive' | 'halted' | 'replay' | 'results' | 'message';
let phase: Phase = 'menu';

interface Run {
  surface: Surface;
  mph: number;
  v: number;
  grip: number;
  decel: number;
  ideal: ReturnType<typeof stoppingDistance>;
  hazardKind: HazardKind;
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
}

let run: Run | null = null;
let lastFrameMs = performance.now();

function pickHazard(dist: number): HazardKind {
  // Smaller hazards only where they are big enough to see on a phone.
  const options: HazardKind[] = dist <= 75 ? ['child', 'deer', 'car'] : dist <= 120 ? ['deer', 'car'] : ['car'];
  return options[Math.floor(Math.random() * options.length)];
}

/** Furthest a hazard is placed, so it is still visible on a phone screen. */
const MAX_HAZARD_DISTANCE = 230;

function startRun(): void {
  const v = mphToMs(settings.mph);
  const grip = SURFACE_GRIP[settings.surface];
  const ideal = stoppingDistance(v, HIGHWAY_CODE_REACTION_S, grip);
  const plannedAppearT = 3 + Math.random() * 3.5;
  // A fair distance: an alert driver stops with a little room to spare.
  const fair = ideal.total * (1.12 + Math.random() * 0.25) + 2;
  const dist = Math.min(fair, MAX_HAZARD_DISTANCE);
  const hazardP = v * plannedAppearT + dist;
  const hazardKind = pickHazard(dist);

  world.setSurface(settings.surface);
  world.buildScenery(Math.floor(Math.random() * 1e9), hazardKind === 'car' ? hazardP : null);
  world.placeHazard(hazardKind, hazardP);
  world.clearPaint();
  world.clearLabels();
  world.setInset({ right: 0, bottom: 0 });
  world.setSceneryRightVisible(true);

  run = {
    surface: settings.surface,
    mph: settings.mph,
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
  };

  idealLabel = world.addLabel(`Alert driver stops: ${Math.round(ideal.total)} m`, ideal.total, 0.2, 'ideal');
  window.setTimeout(() => idealLabel?.style.setProperty('opacity', '0'), 3000);

  ui.menu.classList.add('hidden');
  ui.results.classList.add('hidden');
  ui.message.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  ui.brakeHint.classList.remove('hidden');
  ui.hudSurface.textContent = SURFACE_LABEL[run.surface];
  ui.hudSpeed.textContent = String(run.mph);
  (document.activeElement as HTMLElement | null)?.blur();
  phase = 'drive';
}

let idealLabel: HTMLDivElement | null = null;

/** Exact position (m) and speed (m/s) of the car's front bumper at time t (s) into the run. */
function motionAt(r: Run, t: number): { p: number; speed: number } {
  if (r.brakeT === null || t <= r.brakeT) return { p: r.v * t, speed: r.v };
  const pB = r.v * r.brakeT;
  const tau = t - r.brakeT;
  const tStop = r.v / r.decel;
  if (tau >= tStop) return { p: pB + (r.v * r.v) / (2 * r.decel), speed: 0 };
  return { p: pB + r.v * tau - 0.5 * r.decel * tau * tau, speed: r.v - r.decel * tau };
}

function onBrake(timeStamp: number): void {
  if (phase !== 'drive' || !run || run.brakeT !== null) return;
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
}

function falseStart(text: string): void {
  phase = 'message';
  ui.brakeHint.classList.add('hidden');
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
  world.clearLabels();
  world.clearPaint();
  world.clearHazard();
  world.setIdealMarker(null);
  world.setInset({ right: 0, bottom: 0 });
  world.setSceneryRightVisible(true);
  ui.results.classList.add('hidden');
  ui.message.classList.add('hidden');
  ui.hud.classList.add('hidden');
  ui.brakeHint.classList.add('hidden');
  ui.skip.classList.add('hidden');
  ui.menu.classList.remove('hidden');
  showBest();
  updateBaseline();
}

// ---------------------------------------------------------------------------
// Input: read directly from browser events so reaction times are fair.
// ---------------------------------------------------------------------------

window.addEventListener(
  'keydown',
  (e) => {
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
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'drive') {
    phase = 'message';
    ui.brakeHint.classList.add('hidden');
    showMessage('Paused', 'The game was hidden during the drive, so that run does not count.', [
      { label: 'Try again', primary: true, action: startRun },
      { label: 'Menu', action: showMenu },
    ]);
  }
});

$('start').addEventListener('click', startRun);
$('again').addEventListener('click', startRun);
$('change').addEventListener('click', showMenu);
$('replay').addEventListener('click', () => startReplay());
ui.skip.addEventListener('click', () => finishReplay());
window.addEventListener('resize', () => world.resize());

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

function updateDrive(nowMs: number, dt: number): void {
  const r = run!;
  const t = (nowMs - r.startMs) / 1000;
  let { p, speed } = motionAt(r, t);

  // Hazard appears on the first frame at or after its planned time.
  let justAppeared = false;
  if (r.appearMs === null && t >= r.plannedAppearT) justAppeared = true;

  if (p >= r.hazardP && r.appearT !== null) {
    // The car reached the hazard while still moving: sudden halt.
    r.hit = true;
    r.impactSpeed = speedAtPosition(r, r.hazardP);
    p = r.hazardP;
    speed = 0;
    r.endT = timeAtPosition(r, r.hazardP);
    halt(true);
  } else if (speed === 0 && r.brakeT !== null) {
    r.endT = r.brakeT + r.v / r.decel;
    halt(false);
  }

  world.setCar(p, speed, r.brakeT !== null && t >= r.brakeT, dt);
  world.updateHazard(r.appearT === null ? (justAppeared ? 0 : -1) : t - r.appearT);
  // The faint ideal marker shows where an alert driver would stop if a hazard
  // appeared now. Once the hazard appears it stays where they would stop.
  const markerP = r.appearT === null ? p + r.ideal.total : r.v * r.appearT + r.ideal.total;
  world.setIdealMarker(markerP);
  if (idealLabel) world.moveLabel(idealLabel, markerP);
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
  const pB = r.v * r.brakeT;
  if (pos <= pB) return r.v;
  const v2 = r.v * r.v - 2 * r.decel * (pos - pB);
  return v2 > 0 ? Math.sqrt(v2) : 0;
}

function timeAtPosition(r: Run, pos: number): number {
  if (r.brakeT === null) return pos / r.v;
  const pB = r.v * r.brakeT;
  if (pos <= pB) return pos / r.v;
  const vAt = speedAtPosition(r, pos);
  return r.brakeT + (r.v - vAt) / r.decel;
}

function halt(hit: boolean): void {
  phase = 'halted';
  ui.brakeHint.classList.add('hidden');
  if (hit) {
    ui.flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => ui.flash.classList.remove('on')));
  }
  window.setTimeout(() => {
    if (phase === 'halted') startReplay();
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

  const frameEnd = Math.max(r.hazardP + 3, idealStop <= r.hazardP + 30 ? idealStop + 2 : 0);
  replayFrame = [appearP - 8, frameEnd + 4];
  world.sideCamera(replayFrame[0], replayFrame[1]);
  world.setIdealMarker(idealStop);

  const think = world.paintSegment(appearP, appearP, 0xf2b632);
  const brake = brakeP === null ? null : world.paintSegment(brakeP, brakeP, 0xe0483e);
  world.addLabel('Hazard appears', appearP, 3.4, 'hazard');
  if (idealStop <= frameEnd + 4) world.addLabel(`Alert driver stops (${Math.round(r.ideal.total)} m)`, idealStop, 4.6, 'ideal', -4.6);

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
  world.sideCamera(replayFrame[0], replayFrame[1]);
  ui.skip.classList.add('hidden');
  finishTimer = window.setTimeout(showResults, delay);
}

function showResults(): void {
  const r = run!;
  const appearP = r.v * r.appearT!;
  const dHazard = r.hazardP - appearP;
  const reaction = r.reaction;
  const actual = reaction === null ? null : stoppingDistance(r.v, reaction, r.grip);
  const idealGap = dHazard - r.ideal.total;
  const gap = r.hit || !actual ? 0 : dHazard - actual.total;
  const score = scoreHazardStop(reaction ?? 99, r.hit, gap, idealGap);
  const isBest = saveBest(score.total);

  const result: RunResult = {
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
  ui.results.classList.remove('hidden');
  ui.results.scrollTop = 0;

  // Keep the painted road visible beside or above the results panel.
  const rect = ui.results.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const onRight = rect.left > W * 0.3;
  world.setInset(onRight ? { right: W - rect.left + 8, bottom: 0 } : { right: 0, bottom: Math.min(H * 0.6, H - rect.top + 8) });
  world.reframeSide();
  ($('again') as HTMLButtonElement).focus({ preventScroll: true });
}

function hazardName(k: HazardKind): string {
  return k === 'child' ? 'child' : k === 'deer' ? 'deer' : 'car pulling out';
}

function fmtM(m: number): string {
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Read-only hook for automated play-testing.
(window as unknown as { __rts: () => object }).__rts = () => ({
  phase,
  hazardVisible: run?.appearMs != null,
  hazardKind: run?.hazardKind,
});
