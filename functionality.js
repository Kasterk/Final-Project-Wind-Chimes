/**
 * Wind Chime — functionality.js (Green Glass Shards + Fairy Lights)
 *
 * Each strand has several irregular green glass shards + warm fairy-light dots.
 * Only the touched strand swings and lights up. Plays a chime sound on touch.
 */

// ── DOM references ───────────────────────────────────────────────────────────
const scene       = document.getElementById('scene');
const canvas      = document.getElementById('rays-canvas');
const ctx         = canvas.getContext('2d');
const glowOverlay = document.getElementById('glow-overlay');
const hint        = document.getElementById('hint');
const root        = document.getElementById('chimes-root');

// ── Strand definitions ───────────────────────────────────────────────────────
// x = fraction of scene width; totalLen = wire length in px; note = Hz
const STRAND_DATA = [
  { x: 0.18, totalLen: 310, note: 1046.5 },
  { x: 0.32, totalLen: 340, note:  880.0 },
  { x: 0.46, totalLen: 360, note:  783.9 },
  { x: 0.60, totalLen: 340, note:  698.5 },
  { x: 0.74, totalLen: 310, note:  587.3 },
];

const TOP_Y = 46; // px: where the wire starts (just below bar)
const REFLECTION_Y_OFFSET = 56; // px: push the ray/reflection origin further down

// Shard templates per strand — each is a list of shards.
// Each shard: { yFrac, w, h, rot, clipPath }
// yFrac = position along wire (0–1), rot = extra tilt in deg
// We pre-define varied irregular polygon shapes using clip-path
const SHARD_SHAPES = [
  // shape 0 — wide trapezoid
  'polygon(8% 0%, 92% 5%, 100% 100%, 0% 95%)',
  // shape 1 — asymmetric quad
  'polygon(0% 10%, 85% 0%, 100% 90%, 15% 100%)',
  // shape 2 — chunky triangle-ish
  'polygon(5% 0%, 100% 15%, 90% 100%, 0% 85%)',
  // shape 3 — narrow shard
  'polygon(20% 0%, 80% 5%, 75% 100%, 25% 95%)',
  // shape 4 — broken corner shard
  'polygon(0% 0%, 70% 5%, 100% 60%, 80% 100%, 10% 90%)',
  // shape 5 — wide bottom
  'polygon(15% 0%, 85% 0%, 100% 100%, 0% 95%)',
  // shape 6 — angular shard
  'polygon(0% 20%, 60% 0%, 100% 30%, 95% 100%, 5% 85%)',
  // shape 7 — small square-ish
  'polygon(5% 5%, 95% 0%, 100% 95%, 0% 100%)',
];

// Per-strand shard layout — each array entry defines shards for that strand
// Format: [shapeIndex, yFrac, widthPx, heightPx, rotDeg, xOffsetPx]
const STRAND_LAYOUTS = [
  // strand 0
  [
    [4, 0.10, 48, 35, -8,  -10],
    [1, 0.28, 42, 28,  5,    6],
    [0, 0.46, 52, 32, -4,   -8],
    [2, 0.63, 38, 30, 10,    4],
    [5, 0.80, 44, 26, -6,   -6],
  ],
  // strand 1
  [
    [0, 0.08, 55, 36,  6,    8],
    [3, 0.25, 30, 38, -10,  -4],
    [6, 0.42, 46, 30,  4,    6],
    [1, 0.59, 50, 34, -5,   -8],
    [7, 0.74, 36, 28,  8,    2],
    [2, 0.88, 42, 24, -3,    4],
  ],
  // strand 2
  [
    [2, 0.07, 60, 40, -5,  -12],
    [5, 0.23, 44, 30,  8,    6],
    [0, 0.39, 54, 36, -3,  -10],
    [4, 0.54, 48, 32,  6,    8],
    [1, 0.68, 50, 28, -8,   -4],
    [6, 0.82, 40, 30,  4,    4],
    [3, 0.93, 30, 22, -6,   -2],
  ],
  // strand 3
  [
    [1, 0.09, 52, 34,  7,    4],
    [4, 0.26, 46, 32, -6,   -8],
    [6, 0.43, 50, 36,  4,    6],
    [0, 0.59, 42, 28, -9,   -6],
    [3, 0.74, 34, 38,  5,    2],
    [5, 0.87, 44, 26, -4,    8],
  ],
  // strand 4
  [
    [5, 0.11, 50, 32, -7,   -6],
    [2, 0.28, 40, 30,  6,    4],
    [1, 0.45, 46, 34, -4,   -8],
    [0, 0.62, 52, 28,  8,    6],
    [7, 0.78, 32, 26, -5,    0],
  ],
];

// Fairy light y positions (as fraction of totalLen) for each strand
const FAIRY_LIGHTS = [
  [0.05, 0.22, 0.42, 0.65, 0.85],
  [0.04, 0.18, 0.36, 0.55, 0.73, 0.90],
  [0.04, 0.16, 0.33, 0.50, 0.66, 0.80, 0.94],
  [0.05, 0.20, 0.38, 0.57, 0.74, 0.89],
  [0.06, 0.24, 0.44, 0.64, 0.82],
];

// ── Per-strand physics state ─────────────────────────────────────────────────
let angles  = STRAND_DATA.map(() => 0);
let vels    = STRAND_DATA.map(() => 0);
let lit     = STRAND_DATA.map(() => 0); // 0–1 glow, only on touched strand

const GRAVITY = 0.09;
const DAMPING = 0.97;
const RESTORE = 0.035;

// ── Misc state ───────────────────────────────────────────────────────────────
let strandEls  = []; // [{ wrap, wire, shards:[], lights:[] }, ...]
let animId     = null;
let hintHidden = false;

let groupX = 0;
let isGrabbing    = false;
let activeGrabEl  = null;
let grabPointerId = null;
const grabStart  = { x: 0, y: 0 };
const groupStart = { x: 0, y: 0 };

let dragging = null;
let lastDx   = 0;

// ── Audio ────────────────────────────────────────────────────────────────────
let audioCtx = null;
const audioEl = document.getElementById && document.getElementById('chime-audio');
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playChime(freq) {
  const ac  = getAudio();
  const now = ac.currentTime;

  const masterGain = ac.createGain();
  masterGain.gain.setValueAtTime(0, now);
  masterGain.gain.linearRampToValueAtTime(0.25, now + 0.008);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);
  masterGain.connect(ac.destination);

  const delay  = ac.createDelay(0.5);
  const fbGain = ac.createGain();
  delay.delayTime.value = 0.20;
  fbGain.gain.value     = 0.15;
  delay.connect(fbGain);
  fbGain.connect(delay);
  delay.connect(masterGain);

  [[freq, 1.0], [freq * 2.001, 0.15]].forEach(([f, vol]) => {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(vol, now);
    osc.connect(gain);
    gain.connect(masterGain);
    gain.connect(delay);
    osc.start(now);
    osc.stop(now + 4);
  });
}

// Try playing a user-provided audio file (e.g., chime.mp4 placed next to the app).
// Returns true if a sample was played, false otherwise.
function playChimeSample() {
  try {
    if (audioEl && audioEl.src) {
      const clone = audioEl.cloneNode(true);
      clone.volume = 0.7;
      clone.play().catch(() => {});
      return true;
    }
  } catch (e) {}
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const W = () => scene.offsetWidth;
const H = () => scene.offsetHeight;

function resize() {
  canvas.width  = W();
  canvas.height = H();
}

function hideHint() {
  if (!hintHidden) { hint.style.opacity = '0'; hintHidden = true; }
}

function wake() {
  if (!animId) animId = requestAnimationFrame(tick);
}

function swing(i, force) {
  vels[i] += force;
  lit[i]   = 1;
  if (!playChimeSample()) playChime(STRAND_DATA[i].note);
  hideHint();
  wake();
}

// ── Build DOM ─────────────────────────────────────────────────────────────────
function buildChimes() {
  root.innerHTML = '';
  strandEls = [];

  STRAND_DATA.forEach((d, si) => {
    const wrap = document.createElement('div');
    wrap.className = 'strand-wrap';
    wrap.style.cssText = `position:absolute; top:0; left:0; width:0; height:0;`;

    // Wire
    const wire = document.createElement('div');
    wire.className = 'strand-wire';
    wire.style.height = `${d.totalLen}px`;
    wrap.appendChild(wire);

    // Shards
    const shards = [];
    (STRAND_LAYOUTS[si] || []).forEach(([shapeIdx, yFrac, w, h, rot, xOff]) => {
      const shard = document.createElement('div');
      shard.className = 'shard';
      const yPx = TOP_Y + yFrac * d.totalLen;
      shard.style.cssText = `
        width: ${w}px;
        height: ${h}px;
        top: ${yPx}px;
        left: ${xOff - w / 2}px;
        transform: rotate(${rot}deg);
        clip-path: ${SHARD_SHAPES[shapeIdx]};
        transition: box-shadow 0.4s ease-out, background 0.4s ease-out;
      `;
      wrap.appendChild(shard);
      shards.push(shard);
    });

    // Fairy lights
    const lights = [];
    (FAIRY_LIGHTS[si] || []).forEach(yFrac => {
      const dot = document.createElement('div');
      dot.className = 'fairy-light';
      const yPx = TOP_Y + yFrac * d.totalLen;
      dot.style.top  = `${yPx}px`;
      dot.style.left = '0px';
      wrap.appendChild(dot);
      lights.push(dot);
    });

    // Grab handler on wire (group drag)
    wire.style.pointerEvents = 'auto';
    wire.style.cursor = 'grab';
    wire.addEventListener('pointerdown',   e => onGrabDown(e, wire));
    wire.addEventListener('pointerup',     e => onGrabUp(e));
    wire.addEventListener('pointercancel', e => onGrabUp(e));

    root.appendChild(wrap);
    strandEls.push({ wrap, wire, shards, lights });
  });

  updatePositions();
}

// ── Animation ─────────────────────────────────────────────────────────────────
function updatePositions() {
  const w = W();
  STRAND_DATA.forEach((d, i) => {
    const el = strandEls[i];
    if (!el) return;

    el.wrap.style.left      = `${d.x * w}px`;
    el.wrap.style.top       = `${TOP_Y}px`;
    el.wrap.style.transform = `rotate(${angles[i]}rad)`;

    // Light up shards only on the touched strand
    const glowing = lit[i] > 0.05;
    el.shards.forEach(s => {
      if (glowing) {
        s.classList.add('lit');
      } else {
        s.classList.remove('lit');
      }
    });

    // Fairy lights are visible only while the strand is lit (touched)
    el.lights.forEach(dot => {
      dot.style.opacity = glowing ? (0.6 + lit[i] * 0.4).toFixed(2) : '0';
    });
  });
}

function drawRays() {
  const w = W(), h = H();
  ctx.clearRect(0, 0, w, h);

  STRAND_DATA.forEach((d, i) => {
    if (lit[i] < 0.05) return;

    const a    = angles[i];
    const tipX = d.x * w + Math.sin(a) * (d.totalLen + TOP_Y);
    const tipY = TOP_Y   + Math.cos(a) * (d.totalLen + TOP_Y * 0.5) + REFLECTION_Y_OFFSET;

    for (let r = 0; r < 3; r++) {
      const spread = (r / 2 - 0.5) * 0.5;
      const len    = 35 + r * 10;
      ctx.save();
      ctx.translate(tipX, tipY);
      // rotate the rays opposite the chime angle so they mirror the motion
      ctx.rotate(-a + spread);
      const grad = ctx.createLinearGradient(0, 0, 0, -len);
      grad.addColorStop(0, `rgba(140,255,100, ${lit[i] * 0.40})`);
      grad.addColorStop(1,  'rgba(140,255,100, 0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -len);
      ctx.stroke();
      ctx.restore();
    }
  });
}

function tick() {
  let anyActive = false;

  angles = angles.map((a, i) => {
    vels[i] += -RESTORE * a - GRAVITY * Math.sin(a);
    vels[i] *= DAMPING;
    const na = a + vels[i];

    lit[i] = lit[i] * 0.975;

    if (Math.abs(vels[i]) > 0.0005 || Math.abs(na) > 0.0005 || lit[i] > 0.01) {
      anyActive = true;
    }
    return na;
  });

  updatePositions();
  drawRays();

  animId = anyActive ? requestAnimationFrame(tick) : null;
}

// ── Events ────────────────────────────────────────────────────────────────────
scene.addEventListener('click', e => {
  const mx = e.clientX - scene.getBoundingClientRect().left;
  let closest = -1, minDist = Infinity;
  STRAND_DATA.forEach((d, i) => {
    const dist = Math.abs(mx - d.x * W());
    if (dist < 55 && dist < minDist) { minDist = dist; closest = i; }
  });
  if (closest !== -1) swing(closest, (Math.random() - 0.1) * 0.05 + 0.03);
});

scene.addEventListener('pointerdown', e => {
  const mx = e.clientX - scene.getBoundingClientRect().left;
  let closest = -1, minDist = Infinity;
  STRAND_DATA.forEach((d, i) => {
    const dist = Math.abs(mx - d.x * W());
    if (dist < 40 && dist < minDist) { minDist = dist; closest = i; }
  });
  if (closest !== -1) { dragging = closest; lastDx = mx; hideHint(); }
});

scene.addEventListener('pointermove', e => {
  if (isGrabbing && e.pointerId === grabPointerId) {
    groupX = groupStart.x + (e.clientX - grabStart.x);
    root.style.transform   = `translateX(${groupX}px)`;
    canvas.style.transform = `translateX(${groupX}px)`;
    return;
  }
  if (dragging === null) return;
  const mx = e.clientX - scene.getBoundingClientRect().left;
  vels[dragging] += (mx - lastDx) / W() * 0.12;
  lastDx = mx;
  wake();
});

scene.addEventListener('pointerup',    () => { dragging = null; });
scene.addEventListener('pointerleave', () => { dragging = null; });

function onGrabDown(e, el) {
  e.stopPropagation();
  isGrabbing    = true;
  activeGrabEl  = el;
  grabPointerId = e.pointerId;
  grabStart.x   = e.clientX;
  groupStart.x  = groupX;
  el.setPointerCapture(e.pointerId);
  el.style.cursor = 'grabbing';
  hideHint();
}

function onGrabUp(e) {
  if (!isGrabbing || e.pointerId !== grabPointerId) return;
  isGrabbing = false;
  try { activeGrabEl.releasePointerCapture(e.pointerId); } catch (_) {}
  activeGrabEl.style.cursor = 'grab';
  activeGrabEl = null;
  grabPointerId = null;
}

window.addEventListener('pointerup',     onGrabUp);
window.addEventListener('pointercancel', onGrabUp);
window.addEventListener('resize', () => { resize(); updatePositions(); });

// ── Init ──────────────────────────────────────────────────────────────────────
resize();
buildChimes();
wake();