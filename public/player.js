// 台本(scenes)を Canvas + 読み上げ(Web Speech API) + 自動作曲BGM(Web Audio) + AI挿絵(Pollinations.ai) で再生する
const SPEAKERS = {
  narrator: { label: 'ナレーター', color: '#ffd166', pitch: 1.0, rate: 1.1 },
  op: { label: 'イッチ', color: '#4fa3ff', pitch: 0.8, rate: 1.15 },
  anon: { label: '名無し', color: '#8be28b', pitch: 1.3, rate: 1.25 },
};
const EMO = { laugh: '😂', surprise: '😲', sad: '😢', angry: '💢', excited: '🔥', neutral: '' };

export const imageUrl = (prompt, style, seed) =>
  `https://image.pollinations.ai/prompt/${encodeURIComponent(`${prompt}, ${style}`)}?width=1280&height=720&nologo=true&seed=${seed}`;

export class Player {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.index = 0;
    this.playing = false;
    this.tts = 'speechSynthesis' in window;
    this.bgmOn = true;
    this.images = new Map();
    this.bgm = new Bgm();
    this.onchange = () => {};
    requestAnimationFrame(this.frame.bind(this));
  }

  load(script) {
    this.stop();
    this.script = script;
    this.images.clear();
    this.index = 0;
    this.sceneStart = performance.now();
    this.preload(0);
    this.onchange(0, script.scenes.length, false);
  }

  preload(from) {
    const { scenes, artStyle } = this.script;
    for (let i = from; i < Math.min(from + 4, scenes.length); i++) {
      if (this.images.has(i)) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imageUrl(scenes[i].image, artStyle, (this.script.id?.length || 7) * 1000 + i);
      this.images.set(i, img);
    }
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }
  play() {
    if (!this.script) return;
    if (this.index >= this.script.scenes.length - 1 && this.ended) this.index = 0;
    this.playing = true;
    this.ended = false;
    if (this.bgmOn) this.bgm.start(this.script.mood);
    this.startScene();
  }
  pause() {
    this.playing = false;
    window.speechSynthesis?.cancel();
    clearTimeout(this.timer);
    this.bgm.stop();
    this.onchange(this.index, this.script?.scenes.length || 0, false);
  }
  stop() {
    this.pause();
  }
  setBgm(on) {
    this.bgmOn = on;
    on && this.playing ? this.bgm.start(this.script.mood) : this.bgm.stop();
  }
  go(i) {
    if (!this.script) return;
    this.index = Math.max(0, Math.min(i, this.script.scenes.length - 1));
    this.preload(this.index);
    this.sceneStart = performance.now();
    if (this.playing) this.startScene();
    else this.onchange(this.index, this.script.scenes.length, false);
  }

  startScene() {
    const s = this.script.scenes[this.index];
    this.sceneStart = performance.now();
    this.preload(this.index);
    this.onchange(this.index, this.script.scenes.length, true);
    clearTimeout(this.timer);
    window.speechSynthesis?.cancel();
    const next = () => {
      if (!this.playing) return;
      if (this.index < this.script.scenes.length - 1) {
        this.index++;
        this.startScene();
      } else {
        this.ended = true;
        this.pause();
      }
    };
    const minMs = Math.max(2500, s.text.length * 110);
    if (this.tts) {
      const u = new SpeechSynthesisUtterance(s.text.replace(/[wｗ]{2,}/g, 'わら').replace(/草/g, 'くさ'));
      const sp = SPEAKERS[s.speaker] || SPEAKERS.anon;
      u.lang = 'ja-JP';
      u.pitch = sp.pitch;
      u.rate = sp.rate;
      const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('ja'));
      if (voice) u.voice = voice;
      let done = false;
      const fin = () => !done && ((done = true), (this.timer = setTimeout(next, 500)));
      u.onend = fin;
      u.onerror = fin;
      speechSynthesis.speak(u);
      this.timer = setTimeout(fin, minMs * 3); // 読み上げが止まった時の保険
    } else {
      this.timer = setTimeout(next, minMs);
    }
  }

  frame(now) {
    requestAnimationFrame(this.frame.bind(this));
    const { ctx, cv } = this;
    const W = cv.width;
    const H = cv.height;
    if (!this.script) return;
    const s = this.script.scenes[this.index];
    const t = (now - this.sceneStart) / 1000;
    // 背景: 挿絵 (ゆっくりズーム) / 読み込み前はグラデーション
    const img = this.images.get(this.index);
    if (img?.complete && img.naturalWidth) {
      const z = 1 + Math.min(t, 12) * 0.008;
      const w = W * z;
      const h = H * z;
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#2b2d42');
      g.addColorStop(1, '#8d99ae');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // タイトル帯
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, W, 56);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.script.title.slice(0, 44), 20, 28);
    // 字幕ボックス (タイプライター表示)
    const sp = SPEAKERS[s.speaker] || SPEAKERS.anon;
    const shown = s.text.slice(0, Math.floor(t * 18) + 1);
    const lines = wrap(ctx, shown, W - 120, '34px sans-serif');
    const bh = 70 + Math.max(lines.length, 2) * 46;
    const by = H - bh - 20;
    ctx.fillStyle = 'rgba(10,12,18,.82)';
    roundRect(ctx, 30, by, W - 60, bh, 18);
    ctx.fill();
    ctx.strokeStyle = sp.color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = sp.color;
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(`${sp.label}${s.no ? `  >>${s.no}` : ''} ${EMO[s.emotion] || ''}`, 60, by + 32);
    ctx.fillStyle = '#fff';
    ctx.font = '34px sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, 60, by + 78 + i * 46));
    // 進捗
    ctx.fillStyle = '#e8543c';
    ctx.fillRect(0, H - 6, (W * (this.index + 1)) / this.script.scenes.length, 6);
  }
}

function wrap(ctx, text, maxW, font) {
  ctx.font = font;
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW) {
        out.push(line);
        line = ch;
      } else line += ch;
    }
    out.push(line);
  }
  return out.slice(-5);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 雰囲気(mood)ごとの自動作曲BGM。著作権フリーでオフラインでも鳴る。
const MOODS = {
  chill: { bpm: 80, root: 57, prog: [[0, 4, 7, 11], [5, 9, 12, 16], [2, 5, 9, 12], [7, 11, 14, 17]], wave: 'sine', drums: false },
  hype: { bpm: 140, root: 52, prog: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], wave: 'sawtooth', drums: true },
  funny: { bpm: 120, root: 60, prog: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]], wave: 'square', drums: true },
  sad: { bpm: 66, root: 57, prog: [[0, 3, 7], [8, 12, 15], [5, 8, 12], [7, 10, 14]], wave: 'triangle', drums: false },
  tense: { bpm: 100, root: 50, prog: [[0, 3, 6], [1, 4, 7], [0, 3, 6], [-1, 3, 6]], wave: 'sawtooth', drums: true },
  heartwarming: { bpm: 90, root: 60, prog: [[0, 4, 7, 11], [9, 12, 16], [5, 9, 12, 16], [7, 11, 14]], wave: 'triangle', drums: false },
};

class Bgm {
  start(mood) {
    this.stop();
    const m = MOODS[mood] || MOODS.chill;
    this.ac ||= new (window.AudioContext || window.webkitAudioContext)();
    this.ac.resume();
    this.out = this.ac.createGain();
    this.out.gain.value = 0.07;
    this.out.connect(this.ac.destination);
    const beat = 60 / m.bpm;
    let step = 0;
    let t0 = this.ac.currentTime + 0.1;
    const hz = (n) => 440 * 2 ** ((n - 69) / 12);
    const note = (n, at, dur, type, vol) => {
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = type;
      o.frequency.value = hz(n);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      o.connect(g).connect(this.out);
      o.start(at);
      o.stop(at + dur + 0.05);
    };
    const kick = (at) => {
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.frequency.setValueAtTime(120, at);
      o.frequency.exponentialRampToValueAtTime(40, at + 0.15);
      g.gain.setValueAtTime(1.2, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
      o.connect(g).connect(this.out);
      o.start(at);
      o.stop(at + 0.25);
    };
    // 先読みスケジューラ (8分音符単位)
    this.iv = setInterval(() => {
      while (t0 < this.ac.currentTime + 0.3) {
        const chord = m.prog[Math.floor(step / 8) % m.prog.length];
        if (step % 8 === 0) chord.forEach((c) => note(m.root + c - 12, t0, beat * 4, 'sine', 0.25));
        note(m.root + chord[step % chord.length] + 12, t0, beat * 0.45, m.wave, 0.18);
        if (m.drums && step % 2 === 0) kick(t0);
        step++;
        t0 += beat / 2;
      }
    }, 100);
  }
  stop() {
    clearInterval(this.iv);
    this.out?.disconnect();
    this.out = null;
  }
}
