/**
 * Wind Chime — functionality.js
 *
 * Builds a set of animated, interactive wind chimes in the browser.
 * Each chime swings with a simple pendulum simulation and glows when active.
 * Users can click/drag individual chimes, or grab-drag the entire group.
 *
 * ── DOM elements ────────────────────────────────────────────────────────────
 *   #scene        – full-viewport container (click/drag target)
 *   #rays-canvas  – <canvas> for light-ray drawing
 *   #glow-overlay – ambient glow div shown when any chime is moving
 *   #chimes-root  – container for all generated chime elements
 *   #hint         – "touch or drag" hint that fades on first interaction
 *
 * ── Architecture ────────────────────────────────────────────────────────────
 *   1. buildChimes()  – creates DOM for each chime from CHIME_DATA
 *   2. tick()         – rAF loop: physics → DOM update → canvas draw
 *   3. Event handlers – click/drag on scene + group drag via chime grab
 */

// ── DOM references ───────────────────────────────────────────────────────────

const scene       = document.getElementById('scene');
const canvas      = document.getElementById('rays-canvas');
const ctx         = canvas.getContext('2d');
const glowOverlay = document.getElementById('glow-overlay');
const hint        = document.getElementById('hint');
const root        = document.getElementById('chimes-root');

// ── Chime definitions ────────────────────────────────────────────────────────

/**
 * Each entry defines one chime tube.
 * @type {{ x: number, len: number, color: string }[]}
 *   x     – horizontal position as a fraction of scene width (0–1)
 *   len   – tube height in px
 *   color – base CSS colour when at rest
 */
const CHIME_DATA = [
  { x: 0.28, len: 170, color: '#73d247' },
  { x: 0.37, len: 185, color: '#7dcf58' },
  { x: 0.46, len: 200, color: '#79bc59' },
  { x: 0.55, len: 185, color: '#7dc75b' },
  { x: 0.64, len: 170, color: '#8cce6d' },
];

/** px from the viewport top where all chimes hang from */
const TOP_Y = 60;

// ── Per-chime state arrays (indexed parallel to CHIME_DATA) ─────────────────

let angles  = CHIME_DATA.map(() => 0); // current swing angle (radians)
let vels    = CHIME_DATA.map(() => 0); // angular velocity (radians/frame)
let lit     = CHIME_DATA.map(() => 0); // triggered flash glow (0–1): set to 1 on hit, decays slowly; CSS transition on .chime-glow opacity gives smooth fade-in/out
let ambient = CHIME_DATA.map(() => 0); // slower-decaying ray/bg glow (0–1)

// ── Physics constants ────────────────────────────────────────────────────────

const GRAVITY  = 0.12; // gravitational pull strength
const DAMPING  = 0.96; // velocity multiplier per frame (< 1 = friction)
const RESTORE  = 0.05; // spring-like pull back to vertical

// ── Misc state ───────────────────────────────────────────────────────────────

let chimeEls  = [];   // [{ wrap: HTMLElement, chime: HTMLElement }, ...]
let animId    = null; // rAF handle; null when animation is idle
let hintHidden = false;

// Group-drag state (dragging all chimes together horizontally)
let groupX = 0, groupY = 0;
let isGrabbing     = false;
let activeGrabEl   = null;
let grabPointerId  = null;
const grabStart  = { x: 0, y: 0 };
const groupStart = { x: 0, y: 0 };

// Individual-chime drag state
let dragging = null; // index of chime being individually dragged, or null
let lastDx   = 0;   // previous pointer x used to compute drag delta

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Current scene width in px */
const W = () => scene.offsetWidth;
/** Current scene height in px */
const H = () => scene.offsetHeight;

/** Sync canvas size to scene size (call on resize) */
function resize() {
  canvas.width  = W();
  canvas.height = H();
}

/** Fade out and suppress the hint text on first user interaction */
function hideHint() {
  if (!hintHidden) {
    hint.style.opacity = '0';
    hintHidden = true;
  }
}

/** Start the animation loop if it isn't already running */
function wake() {
  if (!animId) animId = requestAnimationFrame(tick);
}

/**
 * Add a velocity impulse to one chime, starting the animation loop.
 * @param {number} i     – chime index
 * @param {number} force – angular velocity delta
 */
function swing(i, force) {
  vels[i] += force;
  lit[i]   = 1;      // trigger the flash — decays on its own from here
  hideHint();
  wake();
}

// ── DOM construction ──────────────────────────────────────────────────────────

/**
 * (Re-)build all chime elements from CHIME_DATA and append them to #chimes-root.
 * Each chime consists of:
 *   wrap  – an absolutely-positioned container rotated around its top centre
 *   str   – a thin vertical "string" div
 *   chime – the tube itself (has pointer-event handlers for group drag)
 */
function buildChimes() {
  root.innerHTML = '';
  chimeEls = [];

  CHIME_DATA.forEach((d, i) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:absolute; top:${TOP_Y}px; left:0; width:0; height:0;`;

    const str = document.createElement('div');
    str.style.cssText = `
      position: absolute;
      width: 1.5px;
      background: #ccc;
      height: ${d.len * 0.3}px;
      left: -0.75px;
      top: 0;
      transform-origin: top center;
    `;

    const chime = document.createElement('div');
    chime.className = 'chime';
    chime.style.cssText = `width:14px; height:${d.len}px; background:${d.color}; left:-7px; top:${d.len * 0.3}px;`;
    chime.dataset.i = i;

    // Inner glow layer: a full-size child whose opacity is driven by --glow.
    // CSS transitions on opacity give the smooth fade-in/out.
    const glow = document.createElement('div');
    glow.className = 'chime-glow';

    chime.appendChild(glow);

    // Attach group-drag handlers to each tube
    chime.addEventListener('pointerdown',  e => onChimePointerDown(e, chime));
    chime.addEventListener('pointerup',    e => onChimePointerUp(e));
    chime.addEventListener('pointercancel',e => onChimePointerUp(e));

    wrap.appendChild(str);
    wrap.appendChild(chime);
    root.appendChild(wrap);
    chimeEls.push({ wrap, chime, glow });
  });

  updatePositions();
}

// ── Animation: positions and visuals ─────────────────────────────────────────

/**
 * Apply the current angles and glow values to every chime's DOM element.
 * Called once per animation frame.
 *
 * Glow is applied by setting opacity on the .chime-glow child overlay rather
 * than overriding background/boxShadow directly. This lets the CSS
 * `transition: opacity` handle smooth fade-in and fade-out automatically —
 * JS only needs to write a number; the browser interpolates the visual.
 */
function updatePositions() {
  const w = W();
  CHIME_DATA.forEach((d, i) => {
    const el = chimeEls[i];
    if (!el) return;

    el.wrap.style.left      = `${d.x * w}px`;
    el.wrap.style.top       = `${TOP_Y}px`;
    el.wrap.style.transform = `rotate(${angles[i]}rad)`;

    // Set opacity on the inner glow overlay — CSS transition handles the fade.
    el.glow.style.opacity = lit[i].toFixed(3);
  });
}

/**
 * Draw light rays emanating from each active chime's tip onto the canvas.
 * Each chime emits 4 fanned rays whose opacity scales with its ambient glow.
 */
function drawRays() {
  const w = W(), h = H();
  ctx.clearRect(0, 0, w, h);

  CHIME_DATA.forEach((d, i) => {
    if (ambient[i] < 0.03) return;

    const a    = angles[i];
    const tipX = d.x * w + Math.sin(a) * (d.len * 1.3 + TOP_Y);
    const tipY = TOP_Y  + Math.cos(a) * (d.len * 1.3 + TOP_Y * 0.5);

    for (let r = 0; r < 4; r++) {
      const spread = (r / 3 - 0.5) * 0.8;
      const len    = 50 + r * 15;

      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(spread);

      const grad = ctx.createLinearGradient(0, 0, 0, -len);
      grad.addColorStop(0, `rgba(180,215,255, ${ambient[i] * 0.45})`);
      grad.addColorStop(1,  'rgba(180,215,255, 0)');

      ctx.strokeStyle = grad;
      ctx.lineWidth   = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -len);
      ctx.stroke();
      ctx.restore();
    }
  });
}

// ── Animation loop ────────────────────────────────────────────────────────────

/**
 * Single animation frame:
 *   1. Advance pendulum physics for every chime.
 *   2. Update glow values from current speed.
 *   3. Push changes to DOM and canvas.
 *   4. Schedule next frame only if anything is still moving/glowing.
 */
function tick() {
  let anyActive = false;

  angles = angles.map((a, i) => {
    // Pendulum: restoring torque + gravity + damping
    vels[i] += -RESTORE * a - GRAVITY * Math.sin(a);
    vels[i] *= DAMPING;

    const na    = a + vels[i];
    const speed = Math.abs(vels[i]);

    lit[i]     = lit[i] * 0.98; // slow decay; CSS transition smooths the fade-out visually
    ambient[i] = Math.min(1, ambient[i] * 0.97 + speed * 0.50); // slow ray glow, still speed-driven

    if (Math.abs(vels[i]) > 0.0005 || Math.abs(na) > 0.0005 ||
        lit[i] > 0.01 || ambient[i] > 0.01) {
      anyActive = true;
    }

    return na;
  });

  updatePositions();
  drawRays();

  glowOverlay.style.opacity = ambient.some(a => a > 0.05) ? '1' : '0';

  animId = anyActive ? requestAnimationFrame(tick) : null;
}

// ── Event handlers ────────────────────────────────────────────────────────────

/**
 * Click anywhere on the scene: swing every chime within ~36px of the click.
 */
scene.addEventListener('click', e => {
  const mx = e.clientX - scene.getBoundingClientRect().left;
  CHIME_DATA.forEach((d, i) => {
    if (Math.abs(mx - d.x * W()) < 36) {
      swing(i, (Math.random() - 0.1) * 0.06 + 0.04);
    }
  });
});

/**
 * Pointer-down on scene: start individual-chime drag if pointer lands near one.
 */
scene.addEventListener('pointerdown', e => {
  const mx = e.clientX - scene.getBoundingClientRect().left;
  CHIME_DATA.forEach((d, i) => {
    if (Math.abs(mx - d.x * W()) < 28) {
      dragging = i;
      lastDx   = mx;
      lit[i]   = 1;
      hideHint();
    }
  });
});

/**
 * Pointer-move on scene:
 *   - If a group-grab is active, translate the whole chimes root.
 *   - Otherwise, apply velocity to the individually dragged chime.
 */
scene.addEventListener('pointermove', e => {
  if (isGrabbing && e.pointerId === grabPointerId) {
    groupX = groupStart.x + (e.clientX - grabStart.x);
    root.style.transform        = `translateX(${groupX}px)`;
    canvas.style.transform      = `translateX(${groupX}px)`;
    glowOverlay.style.transform = `translateX(${groupX}px)`;
    return;
  }

  if (dragging === null) return;
  const mx     = e.clientX - scene.getBoundingClientRect().left;
  vels[dragging] += (mx - lastDx) / W() * 0.15;
  lastDx = mx;
  wake();
});

scene.addEventListener('pointerup',    () => { dragging = null; });
scene.addEventListener('pointerleave', () => { dragging = null; });

/**
 * Pointer-down on a chime tube: begin group-drag (moves all chimes together).
 * @param {PointerEvent} e
 * @param {HTMLElement}  chime – the element that received the event
 */
function onChimePointerDown(e, chime) {
  e.stopPropagation();
  isGrabbing    = true;
  activeGrabEl  = chime;
  grabPointerId = e.pointerId;
  grabStart.x   = e.clientX;
  grabStart.y   = e.clientY;
  groupStart.x  = groupX;
  groupStart.y  = groupY;
  chime.setPointerCapture(e.pointerId);
  chime.style.cursor = 'grabbing';
  hideHint();
}

/**
 * Pointer-up / cancel on a chime tube: end group-drag.
 * @param {PointerEvent} e
 */
function onChimePointerUp(e) {
  if (!isGrabbing || e.pointerId !== grabPointerId) return;
  isGrabbing = false;
  try { activeGrabEl.releasePointerCapture(e.pointerId); } catch (_) {}
  activeGrabEl.style.cursor = 'grab';
  activeGrabEl  = null;
  grabPointerId = null;
}

// Ensure grab releases even if the pointer leaves the element
window.addEventListener('pointerup',     onChimePointerUp);
window.addEventListener('pointercancel', onChimePointerUp);

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => { resize(); updatePositions(); });

resize();
buildChimes();
wake();