// EMBERLINE — audio: every sound is synthesized with WebAudio, no audio files.
// Each weapon gets its own shot signature; the rest is short blips, sweeps and
// a low wind bed that starts on the first user gesture.
let ctx = null;
let windNodes = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

function tone(freq, dur, type, vol, slideTo = null, delay = 0) {
  if (muted) return;
  const ac = ensure();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseBurst(dur, vol, filterFreq, type = 'lowpass') {
  if (muted) return;
  const ac = ensure();
  if (!ac) return;
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  const gain = ac.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start();
}

export const audio = {
  unlock() {
    const ac = ensure();
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    this.startWind();
  },
  toggleMute() {
    muted = !muted;
    if (muted) this.stopWind();
    else this.startWind();
    return muted;
  },
  get muted() {
    return muted;
  },
  startWind() {
    if (muted || windNodes) return;
    const ac = ensure();
    if (!ac) return;
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      last = last * 0.98 + (Math.random() * 2 - 1) * 0.02;
      data[i] = last * 3;
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = ac.createGain();
    gain.gain.value = 0.05;
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start();
    windNodes = { src, gain };
  },
  stopWind() {
    if (!windNodes) return;
    try {
      windNodes.src.stop();
    } catch {
      /* already stopped */
    }
    windNodes = null;
  },
  // weapon signatures: kind selects the crack; distance muffles it
  shot(kind, distance = 0) {
    const att = Math.max(0.25, 1 - distance / 90);
    if (kind === 'rifle') {
      noiseBurst(0.09, 0.22 * att, 2400);
      tone(190, 0.07, 'square', 0.08 * att, 70);
    } else if (kind === 'shotgun') {
      noiseBurst(0.16, 0.3 * att, 1200);
      tone(120, 0.12, 'square', 0.1 * att, 45);
    } else if (kind === 'marksman') {
      noiseBurst(0.14, 0.26 * att, 3200, 'bandpass');
      tone(320, 0.1, 'sawtooth', 0.07 * att, 90);
    } else {
      noiseBurst(0.07, 0.16 * att, 2000);
      tone(240, 0.05, 'square', 0.06 * att, 90);
    }
  },
  dryFire() {
    tone(1400, 0.03, 'square', 0.05);
  },
  reload() {
    tone(500, 0.05, 'square', 0.05);
    tone(380, 0.05, 'square', 0.05, null, 0.14);
    tone(620, 0.05, 'square', 0.06, null, 0.32);
  },
  hit() {
    tone(1250, 0.05, 'sine', 0.09);
  },
  kill() {
    tone(880, 0.1, 'sine', 0.09);
    tone(1318, 0.16, 'sine', 0.09, null, 0.08);
  },
  hurt() {
    tone(140, 0.18, 'sawtooth', 0.1, 60);
    noiseBurst(0.12, 0.12, 700);
  },
  pickup() {
    tone(660, 0.08, 'sine', 0.08);
    tone(990, 0.12, 'sine', 0.08, null, 0.06);
  },
  heal() {
    tone(523, 0.14, 'sine', 0.08);
    tone(784, 0.2, 'sine', 0.08, null, 0.1);
  },
  armor() {
    tone(330, 0.1, 'triangle', 0.09);
    tone(440, 0.14, 'triangle', 0.09, null, 0.08);
  },
  zoneWarn() {
    tone(440, 0.16, 'square', 0.07, 415);
    tone(440, 0.16, 'square', 0.07, 415, 0.22);
  },
  footstep() {
    noiseBurst(0.05, 0.03, 500);
  },
  jump() {
    noiseBurst(0.06, 0.04, 900);
  },
  victory() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35, 'triangle', 0.09, null, i * 0.11));
  },
  defeat() {
    [392, 330, 262, 175].forEach((f, i) => tone(f, 0.4, 'sawtooth', 0.06, null, i * 0.16));
  },
  click() {
    tone(660, 0.06, 'sine', 0.06);
  },
};
