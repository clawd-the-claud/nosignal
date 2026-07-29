// ============================================================================
//  NO SIGNAL — sound
//  All ambience and effects are synthesised live (Web Audio). All dialogue is
//  spoken live (Web Speech). Nothing here is a file, so the island sounds the
//  same on every machine and loads instantly.
// ============================================================================

export class Sound {
  constructor() {
    this.ready = false;
    this.enabled = true;
    this.fear = 0;
    this.onSubtitle = () => {};
    this.speaking = false;
    this._queue = [];
    this._voices = null;
  }

  async init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = this.ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 24; comp.ratio.value = 7;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    // a big, cold room — the island itself
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._ir(3.2, 2.6);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.30;
    this.verb.connect(this.verbGain).connect(this.master);
    this.send = ctx.createGain();
    this.send.connect(this.verb);

    this.noise = this._noise(4);

    this._wind();
    this._sea();
    this._drone();
    this._static();

    this.ready = true;
  }

  _ir(sec, decay) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * sec);
    const b = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
      let p = 0;
      for (let i = 0; i < len; i++) { p = p * 0.7 + d[i] * 0.3; d[i] = p; }
    }
    return b;
  }

  _noise(sec) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * sec);
    const b = this.ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true; s.start();
    return s;
  }

  /* ------------------------------------------------------------ ambience */
  _wind() {
    const ctx = this.ctx;
    const src = this._loopNoise();
    this.windFilt = ctx.createBiquadFilter();
    this.windFilt.type = 'bandpass'; this.windFilt.frequency.value = 480; this.windFilt.Q.value = 0.55;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.10;
    src.connect(this.windFilt).connect(this.windGain).connect(this.master);

    // slow gusting
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.055;
    const amt = ctx.createGain(); amt.gain.value = 0.055;
    lfo.connect(amt).connect(this.windGain.gain); lfo.start();

    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.021;
    const amt2 = ctx.createGain(); amt2.gain.value = 260;
    lfo2.connect(amt2).connect(this.windFilt.frequency); lfo2.start();
  }

  _sea() {
    const ctx = this.ctx;
    const src = this._loopNoise();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 420;
    this.seaGain = ctx.createGain(); this.seaGain.gain.value = 0.05;
    src.connect(f).connect(this.seaGain).connect(this.master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const amt = ctx.createGain(); amt.gain.value = 0.035;
    lfo.connect(amt).connect(this.seaGain.gain); lfo.start();
  }

  _drone() {
    const ctx = this.ctx;
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 3;
    this.droneGain.connect(f).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.6;
    f.connect(s).connect(this.send);

    this.droneOscs = [];
    [1, 1.0069, 1.5, 2.007].forEach((mult, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sawtooth' : 'sine';
      o.frequency.value = 41.2 * mult;              // low E, detuned
      const g = ctx.createGain(); g.gain.value = 0.5 / (1 + i);
      o.connect(g).connect(this.droneGain);
      o.start();
      this.droneOscs.push(o);
    });
  }

  _static() {
    const ctx = this.ctx;
    const src = this._loopNoise();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1800;
    this.staticGain = ctx.createGain(); this.staticGain.gain.value = 0;
    src.connect(f).connect(this.staticGain).connect(this.master);
  }

  /* ---------------------------------------------------------- per frame */
  update(dt, s) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const fear = this.fear = s.fear;

    this.windGain.gain.setTargetAtTime(0.075 + s.exposure * 0.075 + fear * 0.05, t, 0.5);
    this.seaGain.gain.setTargetAtTime(0.028 + s.nearShore * 0.085, t, 0.6);
    this.droneGain.gain.setTargetAtTime(fear * 0.11 + s.wrong * 0.045, t, 0.9);
    this.staticGain.gain.setTargetAtTime(s.entityNear * 0.055, t, 0.25);

    this.droneOscs.forEach((o, i) => {
      o.frequency.setTargetAtTime(41.2 * [1, 1.0069, 1.5, 2.007][i] * (1 + s.wrong * 0.06), t, 2.0);
    });

    // heartbeat — rate and weight both climb with fear
    this._hb = (this._hb || 0) - dt;
    if (fear > 0.16 && this._hb <= 0) {
      const bpm = 58 + fear * 92;
      this._hb = 60 / bpm;
      this.thump(0.16 + fear * 0.34);
      setTimeout(() => this.thump(0.09 + fear * 0.2), (60 / bpm) * 260);
    }
  }

  thump(gain) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(62, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.001), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.35);
  }

  /* ---------------------------------------------------------------- sfx */
  step(hard = 0.5) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 240 + Math.random() * 420 + hard * 500;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    const peak = 0.045 + hard * 0.055;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    s.connect(f).connect(g).connect(this.master);
    const sd = ctx.createGain(); sd.gain.value = 0.25; g.connect(sd).connect(this.send);
    s.start(t, Math.random() * 3); s.stop(t + 0.2);
  }

  beep(up = true) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(up ? 880 : 620, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.12);
  }

  /** A dissonant cluster. Use sparingly or it stops working. */
  stinger(power = 1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [1, 1.06, 1.414, 2.12].forEach((m, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(150 * m, t);
      o.frequency.exponentialRampToValueAtTime(150 * m * 0.55, t + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10 * power / (1 + i * 0.7), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(g).connect(this.master);
      const sd = ctx.createGain(); sd.gain.value = 0.8; g.connect(sd).connect(this.send);
      o.start(t); o.stop(t + 1.4);
    });

    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09 * power, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + 0.55);
  }

  whisper() {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.35 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 1400; f.Q.value = 6;
    const g = ctx.createGain();
    const dur = 0.7 + Math.random() * 1.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.030, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // sweep so it reads as a mouth, not a hiss
    f.frequency.linearRampToValueAtTime(600 + Math.random() * 900, t + dur);
    s.connect(f).connect(g).connect(this.master);
    const sd = ctx.createGain(); sd.gain.value = 0.9; g.connect(sd).connect(this.send);
    s.start(t, Math.random() * 2); s.stop(t + dur + 0.1);
  }

  scream() {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(160, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    s.connect(f).connect(g).connect(this.master);
    s.start(t); s.stop(t + 1.7);
    this.stinger(1.4);
  }

  /* -------------------------------------------------------------- voice */
  _pickVoices() {
    if (!('speechSynthesis' in window)) return;
    const all = speechSynthesis.getVoices();
    if (!all.length) return;
    const en = all.filter(v => /^en(-|_|$)/i.test(v.lang));
    const pool = en.length ? en : all;
    const pref = (names) => pool.find(v => names.some(n => v.name.toLowerCase().includes(n)));
    this._voices = {
      // the blogger — anything clear and natural
      me: pref(['samantha', 'karen', 'moira', 'tessa', 'google us english', 'zira', 'jenny']) || pool[0],
      // whatever else is talking
      them: pref(['daniel', 'alex', 'fred', 'oliver', 'google uk english male', 'david']) || pool[pool.length - 1],
    };
  }

  /**
   * Speak a line and surface it as a subtitle. Subtitles are not optional —
   * voice availability varies wildly by browser and OS, and the story has to
   * survive a machine with no voices at all.
   */
  say(text, who = 'me', { rate = 1, pitch = 1, onEnd } = {}) {
    this.onSubtitle(text, who);

    if (!('speechSynthesis' in window) || !this.enabled) {
      const ms = 900 + text.length * 52;
      setTimeout(() => { this.onSubtitle(null); onEnd && onEnd(); }, ms);
      return;
    }
    if (!this._voices) this._pickVoices();

    const u = new SpeechSynthesisUtterance(text);
    const v = this._voices && this._voices[who];
    if (v) u.voice = v;
    u.rate = rate * (who === 'them' ? 0.72 : 0.98);
    u.pitch = pitch * (who === 'them' ? 0.45 : 1.02);
    u.volume = who === 'them' ? 1.0 : 0.95;

    this.speaking = true;
    u.onend = u.onerror = () => {
      this.speaking = false;
      this.onSubtitle(null);
      onEnd && onEnd();
    };
    // If speech never fires (blocked, no voices), don't strand the subtitle.
    const guard = setTimeout(() => {
      if (this.speaking) { this.speaking = false; this.onSubtitle(null); onEnd && onEnd(); }
    }, 1200 + text.length * 95);
    u.addEventListener('end', () => clearTimeout(guard));

    try { speechSynthesis.speak(u); }
    catch { this.speaking = false; this.onSubtitle(null); onEnd && onEnd(); }
  }

  shutUp() {
    try { speechSynthesis.cancel(); } catch {}
    this.speaking = false;
    this.onSubtitle(null);
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
    if (m) this.shutUp();
  }
}

// Voices populate asynchronously in Chrome; warm the list as soon as we can.
if ('speechSynthesis' in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
}
