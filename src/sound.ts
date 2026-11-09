// Sound for Room to Stop, synthesised with the Web Audio API so the game
// still ships with no asset files.
//
// - Engine note that rises with speed, different for each vehicle.
// - Road roar, tyre spray in the wet, and rain on wet roads.
// - Tyre squeal (dry), hiss (wet) or scrape (ice) while the brakes bite,
//   and a hiss of air when a lorry driver presses the brake.
// - A thud if the vehicle reaches the hazard.
// - Upbeat music in the menu only, so driving stays focused.
//
// Hazards make no sound, so reaction times are measured from what the
// player sees. Nothing here plays until the player has touched the page
// (browsers block audio before that), and a mute button is always shown.
import type { Surface, Vehicle } from './physics';

export type SoundScene = 'menu' | 'idle' | 'drive' | 'quiet';

interface EngineVoice {
  /** Base pitch (Hz) when pulling away. */
  base: number;
  /** Speed (m/s) covered by each gear. */
  gearSpan: number;
  /** Waveform of the main oscillator. */
  wave: OscillatorType;
  /** Low-pass cutoff (Hz) at rest; it opens up with speed. */
  cutoff: number;
  level: number;
}

const ENGINES: Record<Vehicle, EngineVoice> = {
  car: { base: 46, gearSpan: 8, wave: 'sawtooth', cutoff: 380, level: 0.16 },
  motorbike: { base: 78, gearSpan: 9, wave: 'square', cutoff: 700, level: 0.12 },
  lorry: { base: 28, gearSpan: 5, wave: 'sawtooth', cutoff: 260, level: 0.2 },
};

const MUTE_KEY = 'rts-muted';

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private muted = loadMuted();

  // Continuous voices.
  private engineOsc!: OscillatorNode;
  private engineSub!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private roadGain!: GainNode;
  private sprayGain!: GainNode;
  private rainGain!: GainNode;
  private squealOsc!: OscillatorNode;
  private squealGain!: GainNode;
  private hissGain!: GainNode;
  private scrapeGain!: GainNode;

  private musicGain!: GainNode;
  private musicTimer = 0;
  private musicNextT = 0;
  private musicStep = 0;
  private musicOn = false;

  private vehicle: Vehicle = 'car';

  get isMuted(): boolean {
    return this.muted;
  }

  /** Create the audio graph. Call from inside a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    // Two seconds of white noise, shared by every noisy sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Engine: a main oscillator and a sub-octave through a low-pass filter.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    this.engineGain = this.gain(0);
    this.engineFilter.connect(this.engineGain);
    this.engineOsc = ctx.createOscillator();
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    const subLevel = ctx.createGain();
    subLevel.gain.value = 0.5;
    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(subLevel).connect(this.engineFilter);
    this.engineOsc.start();
    this.engineSub.start();
    this.setVehicle(this.vehicle);

    this.roadGain = this.noiseVoice('lowpass', 420, 0.7);
    this.sprayGain = this.noiseVoice('highpass', 1800, 0.7);
    this.rainGain = this.noiseVoice('bandpass', 5200, 0.4);
    this.hissGain = this.noiseVoice('bandpass', 3200, 1.2);
    this.scrapeGain = this.noiseVoice('lowpass', 260, 3);

    // Tyre squeal: a high note with a fast wobble.
    this.squealGain = this.gain(0);
    this.squealOsc = ctx.createOscillator();
    this.squealOsc.type = 'triangle';
    this.squealOsc.frequency.value = 1050;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 13;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 40;
    wobble.connect(wobbleDepth).connect(this.squealOsc.frequency);
    this.squealOsc.connect(this.squealGain);
    this.squealOsc.start();
    wobble.start();

    this.musicGain = this.gain(0);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  setVehicle(v: Vehicle): void {
    if (v === this.vehicle && this.ctx && this.engineOsc.type === ENGINES[v].wave) return;
    this.vehicle = v;
    if (!this.ctx) return;
    this.engineOsc.type = ENGINES[v].wave;
  }

  /**
   * Called every frame. `speed` is in m/s; `braking` means the brakes are
   * biting (not just pressed).
   */
  update(scene: SoundScene, surface: Surface, speed: number, braking: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const set = (p: AudioParam, v: number, tc = 0.08) => p.setTargetAtTime(v, now, tc);
    const moving = scene === 'drive' ? speed : 0;
    const e = ENGINES[this.vehicle];

    // Engine note within the current gear, rising through the gears.
    const engineOn = scene === 'drive' || scene === 'idle';
    const gear = Math.floor(moving / e.gearSpan);
    const within = (moving - gear * e.gearSpan) / e.gearSpan;
    const f = e.base * (1 + 0.7 * within + 0.18 * gear) * (braking ? 0.94 : 1);
    set(this.engineOsc.frequency, f, 0.05);
    set(this.engineSub.frequency, f / 2, 0.05);
    set(this.engineFilter.frequency, e.cutoff + moving * 22);
    set(this.engineGain.gain, engineOn ? e.level * (0.55 + Math.min(1, moving / 31) * 0.45) * (braking ? 0.6 : 1) : 0);

    const pace = Math.min(1, moving / 31);
    const wet = surface === 'wet';
    set(this.roadGain.gain, 0.05 * pace);
    set(this.sprayGain.gain, wet ? 0.05 * pace : 0);
    set(this.rainGain.gain, wet && scene !== 'quiet' ? 0.035 : wet ? 0.02 : 0, 0.4);

    // Tyres while the brakes bite, fading out as the vehicle stops.
    const bite = braking && scene === 'drive' && speed > 0.5 ? Math.min(1, speed / 8) : 0;
    set(this.squealGain.gain, surface === 'dry' ? 0.035 * bite : 0, 0.03);
    set(this.hissGain.gain, wet ? 0.09 * bite : 0, 0.03);
    set(this.scrapeGain.gain, surface === 'icy' ? 0.12 * bite : 0, 0.03);

    this.setMusic(scene === 'menu');
  }

  /** The driver presses the brake: a lorry's air brakes hiss. */
  brakePressed(): void {
    if (!this.ctx || this.vehicle !== 'lorry') return;
    this.burst('highpass', 2600, 0.14, 0.7);
  }

  /** The vehicle reached the hazard. */
  impact(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.burst('lowpass', 220, 0.6, 0.5);
    const osc = ctx.createOscillator();
    const g = this.gain(0.4);
    osc.frequency.setValueAtTime(90, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.35);
    g.gain.setValueAtTime(0.4, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(g);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  }

  /** Current levels, for automated play-testing. */
  debug(): object {
    if (!this.ctx) return { state: 'locked' };
    return {
      state: this.ctx.state,
      master: this.master.gain.value,
      engine: this.engineGain.gain.value,
      engineHz: this.engineOsc.frequency.value,
      rain: this.rainGain.gain.value,
      squeal: this.squealGain.gain.value,
      hiss: this.hissGain.gain.value,
      music: this.musicOn,
    };
  }

  // -------------------------------------------------------------------------
  // Building blocks
  // -------------------------------------------------------------------------

  private gain(v: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    g.connect(this.master);
    return g;
  }

  /** Looping filtered noise, returned as its (initially silent) gain. */
  private noiseVoice(type: BiquadFilterType, freq: number, q: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // Start each voice at a different point in the buffer so they don't phase.
    src.start(0, Math.random() * 2);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.gain(0);
    src.connect(filter).connect(g);
    return g;
  }

  /** A one-off burst of filtered noise that dies away over `seconds`. */
  private burst(type: BiquadFilterType, freq: number, level: number, seconds: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = this.gain(0);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    src.connect(filter).connect(g);
    src.start(t, Math.random());
    src.stop(t + seconds + 0.05);
  }

  // -------------------------------------------------------------------------
  // Menu music: a short, bright loop, scheduled a little ahead of time.
  // -------------------------------------------------------------------------

  private setMusic(on: boolean): void {
    if (on === this.musicOn || !this.ctx) return;
    this.musicOn = on;
    const now = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(on ? 0.11 : 0, now, on ? 0.3 : 0.15);
    window.clearInterval(this.musicTimer);
    if (!on) return;
    this.musicNextT = now + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 50);
    this.scheduleMusic();
  }

  private scheduleMusic(): void {
    const ctx = this.ctx!;
    const step = 60 / 116 / 2; // eighth notes at 116 bpm
    // C, G, Am, F: root (semitones from C4) and chord tones for the arpeggio.
    const chords = [
      [0, 4, 7, 12],
      [-5, 2, 7, 11],
      [-3, 4, 9, 12],
      [-7, 5, 9, 12],
    ];
    const arp = [0, 1, 2, 3, 2, 1, 2, 3];
    while (this.musicNextT < ctx.currentTime + 0.25) {
      const bar = Math.floor(this.musicStep / 8) % chords.length;
      const i = this.musicStep % 8;
      const chord = chords[bar];
      this.note(262 * 2 ** (chord[arp[i]] / 12), this.musicNextT, step * 0.9, 'triangle', 0.5);
      if (i % 4 === 0) this.note(131 * 2 ** (chord[0] / 12), this.musicNextT, step * 3.6, 'sine', 0.9);
      if (i % 2 === 1) this.hat(this.musicNextT);
      this.musicNextT += step;
      this.musicStep++;
    }
  }

  private note(freq: number, t: number, len: number, type: OscillatorType, level: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  private hat(t: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(filter).connect(g).connect(this.musicGain);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
