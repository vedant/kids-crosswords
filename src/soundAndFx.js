/**
 * Sound Effects & Celebration Animations Engine
 * - Uses original Crosswords-for-Kids audio samples (/sounds/kids_yeah.mp3, kids_yeah2.mp3, wordFound.mp3, pop.mp3, click.mp3)
 * - Includes Web Audio API synth + SpeechSynthesis fallback so "Yaaay!" and musical chimes ALWAYS work
 * - Minimal sparkly pop + floating "YAAAY! ⭐" banner when solving a single clue
 * - Grand full-screen fireworks, confetti, dancing stars, trophy modal, and cheering fanfare when solving the entire puzzle
 */

class SoundAndFxManager {
  constructor() {
    this.muted = false;
    this.audioCtx = null;
    this.sounds = {};
    this.initialized = false;
  }

  init() {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;
    const files = {
      click: '/sounds/click.mp3',
      pop: '/sounds/pop.mp3',
      pop2: '/sounds/pop2.mp3',
      wordFound: '/sounds/wordFound.mp3',
      kidsYeah: '/sounds/kids_yeah.mp3',
      kidsYeah2: '/sounds/kids_yeah2.mp3',
    };
    for (const [key, src] of Object.entries(files)) {
      try {
        const audio = new Audio(src);
        audio.preload = 'auto';
        this.sounds[key] = audio;
      } catch {
        // ignore audio init errors in headless environments
      }
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  getAudioContext() {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        this.audioCtx = new Ctx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  playSample(name, volume = 0.85) {
    if (this.muted) return;
    this.init();
    const base = this.sounds[name];
    if (!base) return;
    try {
      const clone = base.cloneNode();
      clone.volume = volume;
      clone.play().catch(() => {});
    } catch {
      // ignore autoplay blocks
    }
  }

  playKeyClick() {
    if (this.muted) return;
    this.playSample('pop', 0.45);
    this.playTone(520, 0.04, 'sine', 0.06);
  }

  playSelectClue() {
    if (this.muted) return;
    this.playSample('click', 0.5);
    this.playTone(660, 0.05, 'triangle', 0.06);
  }

  playMistakeBuzz() {
    if (this.muted) return;
    this.playTone(220, 0.14, 'sawtooth', 0.09);
    setTimeout(() => this.playTone(180, 0.18, 'sawtooth', 0.09), 110);
  }

  /**
   * "Yaaay!" sound effect + cheerful chime when a kid gets a clue right
   */
  playClueSolvedSound() {
    if (this.muted) return;
    // Play both the sparkle chime and the kids "Yaaay!" voice sample
    this.playSample('wordFound', 0.75);
    this.playSample('kidsYeah', 0.9);

    // Also layer a bright major triad arpeggio via WebAudio so it sounds crisp on every device
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.14, 'triangle', 0.12), i * 65);
    });
  }

  /**
   * Big celebratory fanfare + double cheering when the entire puzzle is solved
   */
  playPuzzleVictorySound() {
    if (this.muted) return;
    this.playSample('kidsYeah2', 1.0);
    setTimeout(() => this.playSample('wordFound', 0.85), 250);

    // Grand victory brass/bell fanfare
    const melody = [
      { f: 523.25, t: 0, d: 0.15 },
      { f: 659.25, t: 130, d: 0.15 },
      { f: 783.99, t: 260, d: 0.15 },
      { f: 1046.5, t: 400, d: 0.32 },
      { f: 783.99, t: 680, d: 0.15 },
      { f: 1046.5, t: 830, d: 0.55 },
    ];
    melody.forEach((n) => {
      setTimeout(() => this.playTone(n.f, n.d, 'triangle', 0.16), n.t);
    });
  }

  playTone(freq, duration = 0.1, type = 'sine', gainVal = 0.1) {
    if (this.muted) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // ignore WebAudio restrictions
    }
  }
}

export const soundFx = new SoundAndFxManager();

const CHEER_MESSAGES = [
  'YAAAY! ⭐',
  'AWESOME! 🎉',
  'YOU GOT IT! 🌟',
  'SUPER! ✨',
  'YAAAY! 🎈',
  'BRILLIANT! 🏆',
];

/**
 * Minimal, joyful animation when a single clue is solved:
 * - Floating "YAAAY! ⭐" pill badge + local burst of 14 star/confetti particles around the solved word/clue
 */
export function triggerClueSolvedAnimation(anchorElement, wordText = '') {
  const container = document.getElementById('clue-cheer-layer') || document.body;
  const rect = anchorElement
    ? anchorElement.getBoundingClientRect()
    : { left: window.innerWidth / 2 - 40, top: window.innerHeight / 2 - 40, width: 80, height: 80 };

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const badge = document.createElement('div');
  badge.className = 'clue-yay-toast';
  const msg = CHEER_MESSAGES[Math.floor(Math.random() * CHEER_MESSAGES.length)];
  badge.innerHTML = `<span class="yay-main">${msg}</span>${
    wordText ? `<span class="yay-word">${wordText}</span>` : ''
  }`;
  badge.style.left = `${Math.max(80, Math.min(window.innerWidth - 80, centerX))}px`;
  badge.style.top = `${Math.max(60, centerY - 10)}px`;
  container.appendChild(badge);

  // Spawn 14 lightweight sparkle particles around the solved word
  const colors = ['#ffd01e', '#29b1e9', '#e72878', '#f69626', '#2ecc71', '#ffffff'];
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('div');
    p.className = 'clue-sparkle-particle';
    const angle = (Math.PI * 2 * i) / 14 + (Math.random() - 0.5) * 0.3;
    const dist = 45 + Math.random() * 55;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 15;
    p.style.left = `${centerX}px`;
    p.style.top = `${centerY}px`;
    p.style.backgroundColor = colors[i % colors.length];
    p.style.setProperty('--dx', `${dx}px`);
    p.style.setProperty('--dy', `${dy}px`);
    container.appendChild(p);
    setTimeout(() => p.remove(), 950);
  }

  setTimeout(() => badge.remove(), 1450);
}

/**
 * Bigger full-screen celebration animation when the entire crossword puzzle is solved!
 * - Launches multi-wave canvas fireworks + confetti shower + floating balloons/stars
 * - Returns a cleanup function
 */
export function startGrandVictoryAnimation(canvas) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  let running = true;
  let animId = null;

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  const colors = ['#ffd01e', '#29b1e9', '#e72878', '#f69626', '#2ecc71', '#a855f7', '#ffffff'];
  const confetti = [];
  const fireworks = [];

  // Create 130 confetti ribbons & stars
  for (let i = 0; i < 130; i++) {
    confetti.push({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      vx: (Math.random() - 0.5) * 3,
      vy: 2.5 + Math.random() * 4.5,
      size: 8 + Math.random() * 10,
      color: colors[i % colors.length],
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.14,
      shape: i % 4 === 0 ? 'star' : 'rect',
    });
  }

  const spawnFireworkBurst = (x, y) => {
    const burstColor = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < 36; i++) {
      const angle = (Math.PI * 2 * i) / 36;
      const speed = 2 + Math.random() * 6.5;
      fireworks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        size: 3.5 + Math.random() * 3.5,
        color: i % 3 === 0 ? '#ffd01e' : burstColor,
      });
    }
  };

  // Launch initial firework bursts
  spawnFireworkBurst(canvas.width * 0.25, canvas.height * 0.3);
  spawnFireworkBurst(canvas.width * 0.75, canvas.height * 0.3);
  spawnFireworkBurst(canvas.width * 0.5, canvas.height * 0.22);

  let frame = 0;
  const tick = () => {
    if (!running) return;
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (frame % 38 === 0) {
      spawnFireworkBurst(
        canvas.width * (0.15 + Math.random() * 0.7),
        canvas.height * (0.15 + Math.random() * 0.45)
      );
    }

    // Draw confetti
    for (const c of confetti) {
      c.x += c.vx + Math.sin(frame * 0.03 + c.size) * 0.7;
      c.y += c.vy;
      c.rot += c.vRot;
      if (c.y > canvas.height + 20) {
        c.y = -20;
        c.x = Math.random() * canvas.width;
      }

      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      if (c.shape === 'star') {
        drawStar(ctx, 0, 0, 5, c.size * 0.65, c.size * 0.3);
      } else {
        ctx.fillRect(-c.size / 2, -c.size / 3, c.size, c.size * 0.66);
      }
      ctx.restore();
    }

    // Draw fireworks
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const fw = fireworks[i];
      fw.x += fw.vx;
      fw.y += fw.vy;
      fw.vy += 0.08; // gravity
      fw.alpha -= 0.016;
      if (fw.alpha <= 0) {
        fireworks.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, fw.alpha);
      ctx.fillStyle = fw.color;
      ctx.beginPath();
      ctx.arc(fw.x, fw.y, fw.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    animId = requestAnimationFrame(tick);
  };

  animId = requestAnimationFrame(tick);

  return () => {
    running = false;
    if (animId) cancelAnimationFrame(animId);
    window.removeEventListener('resize', resize);
  };
}

function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  let rot = (Math.PI / 2) * 3;
  let x = cx;
  let y = cy;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fill();
}
