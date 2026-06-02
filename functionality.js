const scene = document.getElementById('scene');
const canvas = document.getElementById('rays-canvas');
const ctx = canvas.getContext('2d');
const glowOverlay = document.getElementById('glow-overlay');
const hint = document.getElementById('hint');
const root = document.getElementById('chimes-root');

const W = () => scene.offsetWidth;
const H = () => scene.offsetHeight;

const CHIME_DATA = [
  { x: 0.28, len: 145, color: '#a0c4e8' },
  { x: 0.37, len: 170, color: '#b8d4f0' },
  { x: 0.46, len: 200, color: '#cce0f8' },
  { x: 0.55, len: 170, color: '#b0cce8' },
  { x: 0.64, len: 145, color: '#9abcdc' },
];

const TOP_Y = 60; // hang from 60px from the top of the viewport
let chimeEls = [];
let angles = CHIME_DATA.map(() => 0);
let vels = CHIME_DATA.map(() => 0);
let lit = CHIME_DATA.map(() => 0);      // chime glow
let ambient = CHIME_DATA.map(() => 0);  // rays + background glow
let animId;
let hintHidden = false;
// group drag state
let groupX = 0, groupY = 0;
let isGrabbing = false, activeGrabEl = null, grabPointerId = null;
const grabStart = { x: 0, y: 0 };
const groupStart = { x: 0, y: 0 };

function resize() {
  canvas.width = scene.offsetWidth;
  canvas.height = scene.offsetHeight;
}

function buildChimes() {
  root.innerHTML = '';
  chimeEls = [];
  CHIME_DATA.forEach((d, i) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:absolute; top:${TOP_Y}px; left:0; width:0; height:0;`;

    const str = document.createElement('div');
    str.style.cssText = `position:absolute; width:1.5px; background:#ccc; height:${d.len * 0.3}px; left:-0.75px; top:0; transform-origin:top center;`;

    const chime = document.createElement('div');
    chime.className = 'chime';
    chime.style.cssText = `width:14px; height:${d.len}px; background:${d.color}; left:-7px; top:${d.len * 0.3}px;`;
    chime.dataset.i = i;

    // make chime grab the whole group when pointering on it
    chime.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      activeGrabEl = chime;
      isGrabbing = true;
      grabPointerId = e.pointerId;
      grabStart.x = e.clientX;
      grabStart.y = e.clientY;
      groupStart.x = groupX;
      groupStart.y = groupY;
      chime.setPointerCapture(e.pointerId);
      chime.style.cursor = 'grabbing';
      hideHint();
    });
    chime.addEventListener('pointerup', (e) => {
      if (isGrabbing && e.pointerId === grabPointerId) {
        isGrabbing = false;
        if (activeGrabEl) activeGrabEl.releasePointerCapture(e.pointerId);
        if (activeGrabEl) activeGrabEl.style.cursor = 'grab';
        activeGrabEl = null;
        grabPointerId = null;
      }
    });
    chime.addEventListener('pointercancel', (e) => {
      if (isGrabbing && e.pointerId === grabPointerId) {
        isGrabbing = false;
        if (activeGrabEl) activeGrabEl.releasePointerCapture(e.pointerId);
        if (activeGrabEl) activeGrabEl.style.cursor = 'grab';
        activeGrabEl = null;
        grabPointerId = null;
      }
    });

    wrap.appendChild(str);
    wrap.appendChild(chime);
    root.appendChild(wrap);
    chimeEls.push({ wrap, chime });
  });
  updatePositions();
}

function updatePositions() {
  const w = W();
  CHIME_DATA.forEach((d, i) => {
    const el = chimeEls[i];
    if (!el) return;
    el.wrap.style.left = (d.x * w) + 'px';
    el.wrap.style.top = TOP_Y + 'px';
    el.wrap.style.transform = `rotate(${angles[i]}rad)`;
    const l = lit[i];
    if (l > 0.01) {
        const brightness = 62 + l * 18;

        el.chime.style.background =
          `linear-gradient(
            to right,
            hsl(210,70%,${brightness - 10}%),
            hsl(210,90%,${brightness + 15}%),
            hsl(210,70%,${brightness - 10}%)
          )`;

        el.chime.style.boxShadow =
          `
            inset 0 0 ${10 + l * 20}px rgba(220,240,255,${l * 0.8}),
            0 0 ${6 + l * 12}px rgba(180,220,255,${l * 0.4})
          `;
      }
      else {
        el.chime.style.background = d.color;
        el.chime.style.boxShadow = 'none';
      }
  });
}

function drawRays() {
  const w = W(), h = H();
  ctx.clearRect(0, 0, w, h);
  CHIME_DATA.forEach((d, i) => {
    if (ambient[i] < 0.03) return;
    const baseX = d.x * w;
    const a = angles[i];
    const tipX = baseX + Math.sin(a) * (d.len * 1.3 + TOP_Y);
    const tipY = TOP_Y + Math.cos(a) * (d.len * 1.3 + TOP_Y * 0.5);
    for (let r = 0; r < 4; r++) {
      const spread = (r / 3 - 0.5) * 0.8;
      const len = 50 + r * 15;
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(spread);
      const grad = ctx.createLinearGradient(0, 0, 0, -len);
      grad.addColorStop(0, `rgba(180,215,255, ${ambient[i] * 0.45})`);
      grad.addColorStop(1, `rgba(180,215,255,0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -len);
      ctx.stroke();
      ctx.restore();
    }
  });
}

const GRAVITY = 0.12, DAMPING = 0.96, RESTORE = 0.05;

function tick() {
  let anyActive = false;

  angles = angles.map((a, i) => {
    vels[i] += -RESTORE * a - GRAVITY * Math.sin(a);
    vels[i] *= DAMPING;

    const na = a + vels[i];
    const speed = Math.abs(vels[i]);

    // Fast-fading light inside the chime
    lit[i] = Math.min(1, lit[i] * 0.88 + speed * 0.4);

    // Slower fading glow for rays and background
    ambient[i] = Math.min(1, ambient[i] * 0.97 + speed * 0.5);

    if (
      Math.abs(vels[i]) > 0.0005 ||
      Math.abs(na) > 0.0005 ||
      lit[i] > 0.01 ||
      ambient[i] > 0.01
    ) {
      anyActive = true;
    }

    return na;
  });

  updatePositions();
  drawRays();

  glowOverlay.style.opacity =
    ambient.some(a => a > 0.05) ? '1' : '0';

  animId = anyActive ? requestAnimationFrame(tick) : null;
}

function wake() { if (!animId) animId = requestAnimationFrame(tick); }

function hideHint() {
  if (!hintHidden) { hint.style.opacity = '0'; hintHidden = true; }
}

function swing(i, force) {
  vels[i] += force;
  hideHint();
  wake();
}

scene.addEventListener('click', e => {
  const rect = scene.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  CHIME_DATA.forEach((d, i) => {
    const dx = Math.abs(mx - d.x * W());
    if (dx < 36) swing(i, (Math.random() - 0.5) * 0.06 + 0.04);
  });
});

let dragging = null, lastDx = 0;

scene.addEventListener('pointerdown', e => {
  const rect = scene.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  CHIME_DATA.forEach((d, i) => {
    if (Math.abs(mx - d.x * W()) < 28) { dragging = i; lastDx = mx; hideHint(); }
  });
});

scene.addEventListener('pointermove', e => {
  // if the user is grabbing the whole chime group, move it
  if (isGrabbing && e.pointerId === grabPointerId) {
    const dx = e.clientX - grabStart.x;
    // only move horizontally so chimes stay hanging from the top
    groupX = groupStart.x + dx;
    root.style.transform = `translateX(${groupX}px)`;
    canvas.style.transform = `translateX(${groupX}px)`;
    glowOverlay.style.transform = `translateX(${groupX}px)`;
    return;
  }
  if (dragging === null) return;
  const rect = scene.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  vels[dragging] += (mx - lastDx) / W() * 0.15;
  lastDx = mx;
  wake();
});

scene.addEventListener('pointerup', () => { dragging = null; });
scene.addEventListener('pointerleave', () => { dragging = null; });

// ensure grab releases if pointer ends anywhere
window.addEventListener('pointerup', (e) => {
  if (isGrabbing && e.pointerId === grabPointerId) {
    isGrabbing = false;
    if (activeGrabEl) {
      try { activeGrabEl.releasePointerCapture(e.pointerId); } catch (err) {}
      activeGrabEl.style.cursor = 'grab';
    }
    activeGrabEl = null;
    grabPointerId = null;
  }
});
window.addEventListener('pointercancel', (e) => {
  if (isGrabbing && e.pointerId === grabPointerId) {
    isGrabbing = false;
    if (activeGrabEl) {
      try { activeGrabEl.releasePointerCapture(e.pointerId); } catch (err) {}
      activeGrabEl.style.cursor = 'grab';
    }
    activeGrabEl = null;
    grabPointerId = null;
  }
});

window.addEventListener('resize', () => { resize(); updatePositions(); });

resize();
buildChimes();
wake();