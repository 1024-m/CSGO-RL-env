/** Procedural weapon SFX with correct continuous-fire behavior (one-shot pool, not a single loop). */

function createMachinegunShotBuffer(ctx) {
  const rate = ctx.sampleRate;
  const length = Math.floor(0.14 * rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let low = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / rate;
    const env = Math.exp(-t * 28);
    const click = Math.exp(-t * 120) * (Math.random() * 2 - 1);
    low = low * 0.92 + (Math.random() * 2 - 1) * 0.08;
    const body = Math.sin(2 * Math.PI * (90 + t * 40) * t) * Math.exp(-t * 18);
    data[i] = (click * 0.55 + low * 0.7 + body * 0.45) * env;
  }
  return buffer;
}

/** Heavy bolt-rifle report — not a slowed MG. Crack + sub boom + brass ring. */
function createSniperShotBuffer(ctx) {
  const rate = ctx.sampleRate;
  const length = Math.floor(0.95 * rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  let prev = 0;
  let ringLp = 0;

  for (let i = 0; i < length; i += 1) {
    const t = i / rate;
    const white = Math.random() * 2 - 1;
    const hp = white - prev;
    prev = white;

    brown += white * 0.028;
    brown *= 0.993;
    brown = Math.max(-1.2, Math.min(1.2, brown));

    // Supersonic / muzzle crack (harsh HF, very short)
    const crackEnv = Math.exp(-t * 95);
    const crack = (white * 1.4 + hp * 2.2) * crackEnv;

    // Chest-thump pressure (sub + low mid, noise-shaped — not a soft sine)
    const thumpEnv = Math.exp(-t * 5.5) * (t < 0.004 ? t / 0.004 : 1);
    const thump = brown * thumpEnv * 3.4
      + Math.sin(2 * Math.PI * 48 * t) * thumpEnv * 0.55
      + Math.sin(2 * Math.PI * 72 * t) * Math.exp(-t * 14) * 0.35;

    // Metallic bolt / chamber ring (distinct from MG body)
    const ringEnv = Math.exp(-t * 7) * (1 - Math.exp(-t * 80));
    ringLp = ringLp * 0.88 + white * 0.12;
    const ring =
      Math.sin(2 * Math.PI * 2100 * t) * ringEnv * 0.22
      + Math.sin(2 * Math.PI * 3150 * t) * ringEnv * 0.12
      + ringLp * ringEnv * 0.18;

    // Outdoor slap / short echo tail
    const slapEnv = Math.exp(-t * 3.2) * (t > 0.04 ? 1 : t / 0.04);
    const slap = brown * slapEnv * 0.55 + white * Math.exp(-t * 18) * 0.15;

    let s = crack * 1.15 + thump + ring + slap;
    s = Math.tanh(s * 0.85);
    data[i] = s;
  }

  // Light delayed slap (different character than MG one-shot)
  const delay = Math.floor(0.055 * rate);
  for (let i = delay; i < length; i += 1) {
    data[i] += data[i - delay] * 0.28;
  }

  let peak = 1e-6;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
  const norm = 0.98 / peak;
  for (let i = 0; i < length; i += 1) data[i] *= norm;
  return buffer;
}

/** Wide boom + pellet hiss — distinct from sniper crack. */
function createShotgunShotBuffer(ctx) {
  const rate = ctx.sampleRate;
  const length = Math.floor(0.55 * rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  let prev = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / rate;
    const white = Math.random() * 2 - 1;
    const hp = white - prev;
    prev = white;
    brown += white * 0.03;
    brown *= 0.99;

    const blastEnv = Math.exp(-t * 14) * (t < 0.003 ? t / 0.003 : 1);
    const blast = brown * blastEnv * 2.8 + white * blastEnv * 0.9;

    const pelletEnv = Math.exp(-t * 22);
    const pellets = hp * pelletEnv * 1.3 + white * pelletEnv * 0.55;

    const body = Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 12) * 0.4;
    data[i] = Math.tanh((blast + pellets + body) * 0.75);
  }
  let peak = 1e-6;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
  const norm = 0.95 / peak;
  for (let i = 0; i < length; i += 1) data[i] *= norm;
  return buffer;
}

function createSmokePopBuffer(ctx) {
  const rate = ctx.sampleRate;
  const length = Math.floor(0.7 * rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let a = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / rate;
    const white = Math.random() * 2 - 1;
    a = a * 0.94 + white * 0.06;
    const pop = Math.exp(-t * 40) * white * 0.5;
    const hiss = a * Math.exp(-t * 2.2) * (1 - Math.exp(-t * 25));
    data[i] = pop + hiss * 0.85;
  }
  return buffer;
}

function createMeleeBuffer(ctx) {
  const rate = ctx.sampleRate;
  const length = Math.floor(0.22 * rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const t = i / rate;
    const whoosh = (Math.random() * 2 - 1) * Math.exp(-t * 9) * (t < 0.12 ? 1 : 0.35);
    const clang =
      Math.sin(2 * Math.PI * 920 * t) * Math.exp(-t * 22) * 0.35 +
      Math.sin(2 * Math.PI * 1480 * t) * Math.exp(-t * 30) * 0.2;
    data[i] = whoosh * 0.55 + clang;
  }
  return buffer;
}

function createFlameLoopBuffer(ctx) {
  const rate = ctx.sampleRate;
  const length = Math.floor(0.6 * rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let a = 0;
  let b = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    a = a * 0.95 + white * 0.05;
    b = b * 0.8 + white * 0.2;
    const t = i / length;
    const edge = Math.min(t * 20, (1 - t) * 20, 1);
    data[i] = (a * 0.65 + b * 0.45) * edge * 0.9;
  }
  return buffer;
}

function createExplosionBuffer(ctx) {
  // GTA-style outdoor HE: dry crack+boom baked with city-reflection echoes
  const rate = ctx.sampleRate;
  const length = Math.floor(2.4 * rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  const dry = new Float32Array(length);

  let brown = 0;
  let lp = 0;
  let lp2 = 0;
  let prevWhite = 0;

  for (let i = 0; i < length; i += 1) {
    const t = i / rate;
    const white = Math.random() * 2 - 1;

    // Brownian / red noise — physical bass, not a sine "note"
    brown += white * 0.02;
    brown *= 0.996;
    brown = Math.max(-1, Math.min(1, brown));

    // High-pass residual for crack
    const hp = white - prevWhite;
    prevWhite = white;

    // --- Dry blast layers (front ~0.35s is the hit) ---
    // Snap / detonation crack
    const crackEnv = Math.exp(-t * 70);
    const crack = white * crackEnv * 2.2 + hp * crackEnv * 0.8;

    // Fat pressure boom (noise-shaped, saturated)
    const boomEnv = Math.exp(-t * 4.8) * (t < 0.008 ? t / 0.008 : 1);
    let boom = brown * boomEnv * 3.2;
    boom += lp * boomEnv * 1.4;

    // Mid “air rip” / fireball whoosh
    lp = lp * 0.9 + white * 0.1;
    lp2 = lp2 * 0.96 + white * 0.04;
    const whooshEnv = Math.exp(-t * 6.5) * (1 - Math.exp(-t * 40));
    const whoosh = (lp * 0.55 + lp2 * 0.9) * whooshEnv * 2.0;

    // Debris / gravel chatter
    const grit =
      ((Math.random() > 0.92 ? white : 0) * Math.exp(-t * 9) +
        white * Math.exp(-t * 22) * 0.25) * 0.7;

    // Slow room rumble under the tail
    const rumbleEnv = Math.exp(-t * 1.55) * (1 - Math.exp(-t * 12));
    const rumble = brown * rumbleEnv * 1.1;

    let s = crack + boom + whoosh + grit + rumble;
    // Soft clip → hard edge like recorded explosions
    s = Math.tanh(s * 0.7);
    dry[i] = s;
  }

  // Bake GTA outdoor reflections (muffled delayed copies)
  const taps = [
    { delay: 0.0, gain: 1.0, mud: 0 },
    { delay: 0.085, gain: 0.55, mud: 0.35 },
    { delay: 0.175, gain: 0.38, mud: 0.5 },
    { delay: 0.31, gain: 0.28, mud: 0.62 },
    { delay: 0.48, gain: 0.18, mud: 0.72 },
    { delay: 0.72, gain: 0.12, mud: 0.8 },
    { delay: 1.05, gain: 0.07, mud: 0.88 },
  ];

  for (const tap of taps) {
    const offset = Math.floor(tap.delay * rate);
    let echoLp = 0;
    for (let i = 0; i + offset < length; i += 1) {
      let x = dry[i] * tap.gain;
      // Muffle distant echoes
      echoLp = echoLp * (0.75 + tap.mud * 0.22) + x * (0.25 - tap.mud * 0.18);
      x = echoLp * tap.mud + x * (1 - tap.mud);
      data[i + offset] += x;
    }
  }

  // Normalize to strong peak without changing character
  let peak = 1e-6;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
  const norm = 0.95 / peak;
  for (let i = 0; i < length; i += 1) data[i] *= norm;

  return buffer;
}

export class WeaponAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.buffers = {};
    this.flameSource = null;
    this.flameGain = null;
    this.flameActive = false;
  }

  async init() {
    if (this.ready) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;

      this.ctx = new Ctx();
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);

      this.buffers.machinegun = createMachinegunShotBuffer(this.ctx);
      this.buffers.sniper = createSniperShotBuffer(this.ctx);
      this.buffers.shotgun = createShotgunShotBuffer(this.ctx);
      this.buffers.smoke = createSmokePopBuffer(this.ctx);
      this.buffers.melee = createMeleeBuffer(this.ctx);
      this.buffers.flame = createFlameLoopBuffer(this.ctx);
      this.buffers.explosion = createExplosionBuffer(this.ctx);
      this.ready = true;
    })();

    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  _playBuffer(buffer, { volume = 1, playbackRate = 1 } = {}) {
    if (!this.ready || !buffer) return;
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buffer;
    src.playbackRate.value = playbackRate;
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this.master);
    src.start();
  }

  _resumeIfNeeded() {
    if (this.ctx?.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  /** One discrete shot per call — stack/overlap for automatic fire. */
  playMachinegunShot() {
    if (!this.ready) return;
    this._resumeIfNeeded();
    const rate = 0.92 + Math.random() * 0.16;
    this._playBuffer(this.buffers.machinegun, { volume: 0.85, playbackRate: rate });
  }

  playSniperShot() {
    if (!this.ready) return;
    this._resumeIfNeeded();
    // Louder / heavier than MG — slight rate jitter only, keep body intact
    const rate = 0.97 + Math.random() * 0.04;
    this._playBuffer(this.buffers.sniper, { volume: 1.45, playbackRate: rate });
  }

  playShotgunShot() {
    if (!this.ready) return;
    this._resumeIfNeeded();
    const rate = 0.95 + Math.random() * 0.06;
    this._playBuffer(this.buffers.shotgun, { volume: 1.25, playbackRate: rate });
  }

  playSmokePop() {
    if (!this.ready) return;
    this._resumeIfNeeded();
    this._playBuffer(this.buffers.smoke, { volume: 0.75, playbackRate: 0.95 + Math.random() * 0.08 });
  }

  playExplosion() {
    if (!this.ready) return;
    this._resumeIfNeeded();

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.explosion;
    src.playbackRate.value = 0.94 + Math.random() * 0.05;

    // Mild saturation for that recorded/overdriven blast body
    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i += 1) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(x * 1.8);
    }
    shaper.curve = curve;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowshelf';
    filter.frequency.value = 140;
    filter.gain.value = 6;

    const gain = this.ctx.createGain();
    gain.gain.value = 1.0;

    src.connect(shaper);
    shaper.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
  }

  playMeleeSwing() {
    if (!this.ready) return;
    this._resumeIfNeeded();
    const rate = 0.9 + Math.random() * 0.2;
    this._playBuffer(this.buffers.melee, { volume: 0.7, playbackRate: rate });
  }

  // Aliases for older call sites / stale module mixes
  playGunShot() {
    this.playMachinegunShot();
  }

  setFlamethrowerFiring(on) {
    if (!this.ready) return;
    this._resumeIfNeeded();

    if (on) {
      if (this.flameActive) return;
      this.flameActive = true;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers.flame;
      src.loop = true;
      src.connect(gain);
      gain.connect(this.master);
      src.start();
      gain.gain.exponentialRampToValueAtTime(0.45, this.ctx.currentTime + 0.08);

      this.flameSource = src;
      this.flameGain = gain;
      return;
    }

    if (!this.flameActive) return;
    this.flameActive = false;
    const gain = this.flameGain;
    const src = this.flameSource;
    this.flameGain = null;
    this.flameSource = null;
    if (!gain || !src) return;

    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.001), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    try {
      src.stop(now + 0.14);
    } catch {
      // already stopped
    }
  }

  stopAll() {
    this.setFlamethrowerFiring(false);
  }
}
