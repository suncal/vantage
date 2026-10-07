/* VANTAGE — daily 3D perspective puzzle.
   ~150-250 blocks float in apparent chaos; from exactly one secret camera
   angle they project into a recognizable silhouette. Blocks are placed along
   PERSPECTIVE rays from the secret camera position (not parallel rays) with a
   wide depth spread, and each block is scaled by its depth — so projected
   sizes are uniform only from the secret angle, and the antipodal "mirror"
   view stays scrambled. Warmth (steel-blue → amber) + motion-calming guide
   the hunt; on solve, blocks snap crisp and take on the image's true colors. */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ---------- tuning ----------
let RADIUS = 26;              // orbit radius (player + secret camera); grows on
                              // narrow screens so the aligned image fits the width
const FOV = 42;
const WORLD = 13;             // silhouette width in world units at the picture plane
const MAX_BLOCKS = 330;
const DEPTH_MIN = 0.55, DEPTH_MAX = 1.45;  // t along ray, ×distance-to-plane
const TOL = THREE.MathUtils.degToRad(5.5);       // solve tolerance
const WARM_RANGE = THREE.MathUtils.degToRad(45); // warmth starts here
const EL_CLAMP = THREE.MathUtils.degToRad(70);   // player elevation limit
const EL_SECRET = THREE.MathUtils.degToRad(52);  // secret elevation limit
const MAX_HINTS = 3;
const EPOCH = Date.UTC(2026, 7, 15); // Aug 15 2026 = puzzle #1

// ---------- puzzles ----------
// Curated for silhouette strength: every entry has a distinctive OUTLINE at
// ~26px grid resolution (bounding-box fill ratio < ~0.6 or an iconic shape).
// Round-blob emoji (penguin head, pumpkin, crown...) tested unreadable — cut.
const PUZZLES = [
  ['🦋', 'Butterfly'], ['🚀', 'Rocket'], ['⚓', 'Anchor'], ['🌵', 'Cactus'],
  ['🎸', 'Guitar'], ['🦩', 'Flamingo'], ['🌙', 'Moon'], ['⭐', 'Star'],
  ['🦖', 'T-Rex'], ['🎈', 'Balloon'], ['🚲', 'Bicycle'], ['🔑', 'Key'],
  ['🌂', 'Umbrella'], ['🐎', 'Horse'], ['🦅', 'Eagle'], ['🦈', 'Shark'],
  ['🚁', 'Helicopter'], ['🗽', 'Liberty'], ['❤️', 'Heart'], ['✂️', 'Scissors'],
  ['🏆', 'Trophy'], ['🪁', 'Kite'], ['🛸', 'UFO'], ['🦴', 'Bone'],
  ['🌴', 'Palm Tree'], ['🗼', 'Tower'], ['⚡', 'Lightning'], ['☀️', 'Sun'],
  ['🎄', 'Xmas Tree'], ['🐍', 'Snake'], ['🦒', 'Giraffe'], ['🍦', 'Ice Cream'],
];

// ---------- deterministic rng ----------
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- silhouette sampling ----------
// Rasterize the emoji BIG (no clipping), find its bounding box, then
// downsample onto the largest grid whose filled-cell count fits the block
// budget — keeping EVERY filled cell so the image has no holes.
function sampleSilhouette(emoji) {
  const BIG = 200;
  const cv = document.createElement('canvas');
  cv.width = BIG; cv.height = BIG;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, BIG, BIG);
  ctx.font = '128px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, BIG / 2, BIG / 2 + 8);
  const img = ctx.getImageData(0, 0, BIG, BIG).data;

  // bounding box of visible pixels
  let x0 = BIG, x1 = 0, y0 = BIG, y1 = 0, any = false;
  for (let y = 0; y < BIG; y++) for (let x = 0; x < BIG; x++) {
    if (img[(y * BIG + x) * 4 + 3] > 80) {
      any = true;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (!any) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  for (let G = 30; G >= 10; G--) {
    // grid dims preserving aspect, longest side = G
    const gw = bw >= bh ? G : Math.max(2, Math.round(G * bw / bh));
    const gh = bh > bw ? G : Math.max(2, Math.round(G * bh / bw));
    const pts = [];
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      // average the source pixels under this cell
      const sx0 = x0 + Math.floor(gx * bw / gw), sx1 = x0 + Math.floor((gx + 1) * bw / gw);
      const sy0 = y0 + Math.floor(gy * bh / gh), sy1 = y0 + Math.floor((gy + 1) * bh / gh);
      let n = 0, hit = 0, r = 0, g = 0, b = 0;
      for (let sy = sy0; sy < Math.max(sy1, sy0 + 1); sy++) for (let sx = sx0; sx < Math.max(sx1, sx0 + 1); sx++) {
        const i = (sy * BIG + sx) * 4;
        n++;
        if (img[i + 3] > 80) { hit++; r += img[i]; g += img[i + 1]; b += img[i + 2]; }
      }
      if (n > 0 && hit / n > 0.32) {
        pts.push({ x: gx, y: gy, r: r / hit / 255, g: g / hit / 255, b: b / hit / 255 });
      }
    }
    if (pts.length <= MAX_BLOCKS && pts.length >= 110) {
      const scale = WORLD / Math.max(gw, gh);
      const cx = (gw - 1) / 2, cy = (gh - 1) / 2;
      return {
        pts: pts.map(p => ({ wx: (p.x - cx) * scale, wy: (cy - p.y) * scale, r: p.r, g: p.g, b: p.b })),
        pitch: scale,
      };
    }
  }
  return null;
}

// ---------- puzzle build ----------
function buildPuzzle(seedStr) {
  const rng = mulberry32(hashStr(seedStr));
  const [emoji, name] = PUZZLES[Math.floor(rng() * PUZZLES.length)];
  const sil = sampleSilhouette(emoji);
  if (!sil) return null;

  const az = rng() * Math.PI * 2;
  const el = (rng() * 2 - 1) * EL_SECRET;
  const secretDir = new THREE.Vector3(
    Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const secretPos = secretDir.clone().multiplyScalar(RADIUS);

  // view basis at the secret camera (same lookAt(origin, +Y up) the player uses)
  const m = new THREE.Matrix4().lookAt(secretPos, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
  const right = new THREE.Vector3().setFromMatrixColumn(m, 0);
  const upv = new THREE.Vector3().setFromMatrixColumn(m, 1);

  const blocks = sil.pts.map(p => {
    // point on the picture plane (through the origin)
    const plane = new THREE.Vector3()
      .addScaledVector(right, p.wx)
      .addScaledVector(upv, p.wy);
    const rayDir = plane.clone().sub(secretPos);
    const planeDist = rayDir.length();
    rayDir.divideScalar(planeDist);
    const t = DEPTH_MIN + rng() * (DEPTH_MAX - DEPTH_MIN);
    return {
      pos: secretPos.clone().addScaledVector(rayDir, planeDist * t),
      size: sil.pitch * 1.04 * t,      // uniform projected size from the secret angle only
      qChaos: new THREE.Quaternion().setFromEuler(new THREE.Euler(
        (rng() - 0.5) * 1.4, (rng() - 0.5) * 1.4, (rng() - 0.5) * 1.4)),
      phase: rng() * Math.PI * 2,
      img: new THREE.Color(p.r, p.g, p.b),
    };
  });

  // blocks slerp toward this orientation as warmth rises, so they present a
  // flat face to the secret camera — the image crisps into clean tiles
  const qView = new THREE.Quaternion().setFromRotationMatrix(m);

  return { emoji, name, blocks, az, el, secretDir, secretPos, qView };
}

// ---------- three.js scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x06070c);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x06070c, 0.0065);

const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

scene.add(new THREE.AmbientLight(0xdfe6f2, 0.75));
const key = new THREE.DirectionalLight(0xfff4e0, 1.5);
key.position.set(10, 18, 12);
scene.add(key);
const rim = new THREE.DirectionalLight(0x6f8fd0, 0.9);
rim.position.set(-12, -4, -10);
scene.add(rim);

// dust field for depth
{
  const N = 400, pos = new Float32Array(N * 3);
  const drng = mulberry32(1337);
  for (let i = 0; i < N; i++) {
    const r = 16 + drng() * 34, th = drng() * Math.PI * 2, ph = Math.acos(2 * drng() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x5a6a95, size: 0.09, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })));
}

// block mesh (rebuilt per puzzle)
let mesh = null, puzzle = null, COUNT = 0;
const basePalette = [new THREE.Color(0x8b95a8), new THREE.Color(0x6b7686), new THREE.Color(0xaab3c4), new THREE.Color(0x4a5262)];
const amber = new THREE.Color(0xffb345);
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const baseCols = [];

function loadPuzzle(seedStr) {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
  puzzle = buildPuzzle(seedStr);
  COUNT = puzzle.blocks.length;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.25 });
  mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  const crng = mulberry32(hashStr(seedStr + ':c'));
  baseCols.length = 0;
  for (let i = 0; i < COUNT; i++) {
    baseCols.push(basePalette[Math.floor(crng() * basePalette.length)]);
    mesh.setColorAt(i, baseCols[i]);
  }
  mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
}

// ---------- game state ----------
const S = { PLAYING: 0, LOCKING: 1, SOLVED: 2 };
let state = S.PLAYING;
let mode = 'daily';           // 'daily' | 'endless'
let endlessCount = 0;
let startT = 0, solveT = 0, hintsUsed = 0, timerRunning = false;
let revealT = -10, waveT = -10;
const waveCenter = new THREE.Vector3();

const dayNum = Math.floor((Date.now() - EPOCH) / 86400000) + 1;

// camera orbit state
const cam = { az: 0, el: 0.2, vaz: 0, vel: 0 };
let lockAnim = null;          // {t0, fromAz, fromEl}

function angDistTo(az, el) {
  const d = new THREE.Vector3(Math.cos(cam.el) * Math.sin(cam.az), Math.sin(cam.el), Math.cos(cam.el) * Math.cos(cam.az));
  const s = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  return Math.acos(THREE.MathUtils.clamp(d.dot(s), -1, 1));
}

function randomStartAngle(rng) {
  // spawn at least 70° away from the secret so it can't auto-solve
  for (let k = 0; k < 40; k++) {
    cam.az = rng() * Math.PI * 2;
    cam.el = (rng() * 2 - 1) * 0.6;
    if (angDistTo(puzzle.az, puzzle.el) > THREE.MathUtils.degToRad(70)) return;
  }
}

// ---------- storage ----------
const store = {
  get() { try { return JSON.parse(localStorage.getItem('vantage') || '{}'); } catch { return {}; } },
  set(d) { localStorage.setItem('vantage', JSON.stringify(d)); },
};

// ---------- HUD ----------
const $ = id => document.getElementById(id);
const timerEl = $('timer'), fillEl = $('signalfill'), hintBtn = $('hintbtn');

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove('show'), ms);
}

let currentSeed = null;
function startRound(seedStr, label) {
  currentSeed = seedStr;
  loadPuzzle(seedStr);
  randomStartAngle(mulberry32(hashStr(seedStr + ':s')));
  state = S.PLAYING;
  hintsUsed = 0;
  revealT = -10; waveT = -10;
  lockAnim = null;
  $('hintsleft').textContent = MAX_HINTS;
  hintBtn.disabled = false;
  hintBtn.classList.remove('pulse');
  $('puzzleno').textContent = label;
  $('solved').classList.remove('show');
  startT = performance.now();
  timerRunning = true;
}

// ---------- solve ----------
function onSolve() {
  state = S.LOCKING;
  timerRunning = false;
  solveT = performance.now() - startT;
  lockAnim = { t0: performance.now(), fromAz: cam.az, fromEl: cam.el };
  cam.vaz = cam.vel = 0;

  let streak = '–';
  if (mode === 'daily') {
    const d = store.get();
    if (d.lastDay !== dayNum) {
      d.streak = (d.lastDay === dayNum - 1) ? (d.streak || 0) + 1 : 1;
      d.lastDay = dayNum;
      d.results = d.results || {};
      d.results[dayNum] = { time: Math.round(solveT), hints: hintsUsed };
      store.set(d);
    }
    streak = `${store.get().streak || 1}🔥`;
  }

  $('answeremoji').textContent = puzzle.emoji;
  $('answername').textContent = puzzle.name;
  $('stat-time').textContent = fmtTime(solveT);
  $('stat-hints').textContent = hintsUsed;
  $('stat-streak').textContent = mode === 'daily' ? streak : '–';
  $('sharefeedback').textContent = '';

  setTimeout(() => {
    state = S.SOLVED;
    revealT = performance.now() / 1000;
    setTimeout(() => $('solved').classList.add('show'), 2100); // let the reveal breathe first
  }, 850);
}

function shareText() {
  const d = store.get();
  const streakPart = (mode === 'daily' && d.streak > 1) ? ` · 🔥${d.streak}-day streak` : '';
  const which = mode === 'daily' ? `#${dayNum}` : 'endless';
  return `VANTAGE ◇ ${which} — ⏱ ${fmtTime(solveT)} · 💡${hintsUsed}${streakPart}\nCan you find the angle?`;
}

// ---------- input: custom orbit ----------
let dragging = false, px = 0, py = 0, downT = 0, moved = 0;
canvas.addEventListener('pointerdown', e => {
  if (state !== S.PLAYING && state !== S.SOLVED) return;
  dragging = true; moved = 0; downT = performance.now();
  px = e.clientX; py = e.clientY;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - px, dy = e.clientY - py;
  moved += Math.abs(dx) + Math.abs(dy);
  px = e.clientX; py = e.clientY;
  cam.az -= dx * 0.005;
  cam.el = THREE.MathUtils.clamp(cam.el + dy * 0.004, -EL_CLAMP, EL_CLAMP);
  cam.vaz = -dx * 0.005; cam.vel = dy * 0.004;
});
canvas.addEventListener('pointerup', e => {
  dragging = false;
  canvas.classList.remove('dragging');
  // quick tap → shockwave (pure juice, borrowed from the Everbuilt engine)
  if (moved < 6 && performance.now() - downT < 300 && state === S.PLAYING) {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    const along = new THREE.Vector3().sub(rc.ray.origin).dot(rc.ray.direction);
    waveCenter.copy(rc.ray.origin).addScaledVector(rc.ray.direction, along);
    waveT = performance.now() / 1000;
  }
});
window.addEventListener('wheel', e => {
  if (state !== S.PLAYING && state !== S.SOLVED) return;
  cam.az += e.deltaX * 0.0022;
  cam.el = THREE.MathUtils.clamp(cam.el + e.deltaY * 0.0022, -EL_CLAMP, EL_CLAMP);
}, { passive: true });

// hint: swing 38% of the way toward the secret angle
hintBtn.addEventListener('click', () => {
  if (state !== S.PLAYING || hintsUsed >= MAX_HINTS) return;
  hintsUsed++;
  $('hintsleft').textContent = MAX_HINTS - hintsUsed;
  if (hintsUsed >= MAX_HINTS) hintBtn.disabled = true;
  hintBtn.classList.remove('pulse');
  // shortest-path azimuth wrap
  let dAz = puzzle.az - cam.az;
  dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
  const targetAz = cam.az + dAz * 0.38;
  const targetEl = cam.el + (puzzle.el - cam.el) * 0.38;
  const from = { az: cam.az, el: cam.el }, t0 = performance.now();
  (function anim() {
    const t = Math.min(1, (performance.now() - t0) / 550);
    const k = t * t * (3 - 2 * t);
    cam.az = from.az + (targetAz - from.az) * k;
    cam.el = from.el + (targetEl - from.el) * k;
    if (t < 1) requestAnimationFrame(anim);
  })();
});

// ---------- resize ----------
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  // portrait screens: back the whole orbit off so the 13-unit-wide image fits
  const need = 26 * THREE.MathUtils.clamp(1.45 / camera.aspect, 1, 2.4);
  if (!currentSeed) RADIUS = need;
  else if (Math.abs(need - RADIUS) / RADIUS > 0.12) {
    RADIUS = need;
    loadPuzzle(currentSeed); // same seed → same shape, rescaled to the new orbit
  }
}
addEventListener('resize', resize);
resize();

// ---------- main loop ----------
const smooth = t => t * t * (3 - 2 * t);
let lastHintNudge = 0;

function tick(now) {
  requestAnimationFrame(tick);
  const t = now / 1000;

  // inertia when not dragging
  if (!dragging && state === S.PLAYING) {
    cam.az += cam.vaz; cam.vaz *= 0.94;
    cam.el = THREE.MathUtils.clamp(cam.el + cam.vel, -EL_CLAMP, EL_CLAMP);
    cam.vel *= 0.94;
  }

  // locking animation: glide onto the exact secret angle
  // (runs to completion regardless of state, so a stalled frame can't strand
  // the camera short of the target)
  if (lockAnim) {
    const raw = Math.min(1, (now - lockAnim.t0) / 800);
    const k = smooth(raw);
    let dAz = puzzle.az - lockAnim.fromAz;
    dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
    cam.az = lockAnim.fromAz + dAz * k;
    cam.el = lockAnim.fromEl + (puzzle.el - lockAnim.fromEl) * k;
    if (raw >= 1) { cam.az = puzzle.az; cam.el = puzzle.el; lockAnim = null; }
  }

  camera.position.set(
    RADIUS * Math.cos(cam.el) * Math.sin(cam.az),
    RADIUS * Math.sin(cam.el),
    RADIUS * Math.cos(cam.el) * Math.cos(cam.az));
  camera.lookAt(0, 0, 0);

  if (!puzzle) { renderer.render(scene, camera); return; }

  // warmth
  const ang = angDistTo(puzzle.az, puzzle.el);
  let warm = state === S.PLAYING ? Math.pow(THREE.MathUtils.clamp(1 - ang / WARM_RANGE, 0, 1), 1.6) : 1;

  // solve check
  if (state === S.PLAYING && ang < TOL && timerRunning) onSolve();

  // HUD
  if (timerRunning) timerEl.textContent = fmtTime(now - startT);
  if (state === S.PLAYING) {
    fillEl.style.width = `${Math.round(warm * 100)}%`;
    const hue = 215 - warm * 175; // steel blue → amber
    fillEl.style.backgroundColor = `hsl(${hue}, ${45 + warm * 45}%, ${52 + warm * 8}%)`;
    // nudge toward hint if stuck cold for 45s
    if (timerRunning && now - startT > 45000 && warm < 0.05 && hintsUsed < MAX_HINTS && now - lastHintNudge > 45000) {
      hintBtn.classList.add('pulse');
      lastHintNudge = now;
    }
  } else {
    fillEl.style.width = '100%';
    fillEl.style.backgroundColor = '#ffb345';
  }

  // blocks
  const revealAge = t - revealT;
  const waveAge = t - waveT;
  for (let i = 0; i < COUNT; i++) {
    const b = puzzle.blocks[i];
    const calm = state === S.PLAYING ? warm : 1;
    const wob = (1 - calm * 0.92) * 0.34;
    let x = b.pos.x + Math.sin(t * 0.9 + b.phase) * wob;
    let y = b.pos.y + Math.sin(t * 1.2 + b.phase * 2.1) * wob;
    let z = b.pos.z + Math.cos(t * 0.7 + b.phase) * wob;

    // tap shockwave
    let glow = 0;
    if (waveAge < 1.4) {
      const d = Math.hypot(x - waveCenter.x, y - waveCenter.y, z - waveCenter.z);
      const band = 1 - Math.min(1, Math.abs(d - waveAge * 16) / 2.2);
      if (band > 0) {
        const amp = band * band * (1 - waveAge / 1.4) * 1.1;
        const inv = d > 0.001 ? amp / d : 0;
        x += (x - waveCenter.x) * inv;
        y += (y - waveCenter.y) * inv;
        z += (z - waveCenter.z) * inv;
        glow = band * (1 - waveAge / 1.4);
      }
    }

    dummy.position.set(x, y, z);
    dummy.quaternion.slerpQuaternions(b.qChaos, puzzle.qView, smooth(calm));
    dummy.scale.setScalar(b.size);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    // color: base → amber with warmth shimmer; on reveal, sweep to true image colors
    tmpColor.copy(baseCols[i]);
    const shimmer = warm * (0.55 + 0.45 * Math.sin(t * 2.4 + b.phase * 3));
    if (state === S.PLAYING) {
      const mix = Math.max(shimmer * 0.85, glow);
      if (mix > 0.01) tmpColor.lerp(amber, Math.min(1, mix));
    } else {
      // gold flash sweeping outward from center, then settle into image colors
      const d = Math.hypot(b.pos.x, b.pos.y, b.pos.z);
      if (revealAge > 0) {
        const sweep = THREE.MathUtils.clamp((revealAge * 26 - d) / 6, 0, 1);
        tmpColor.copy(amber).lerp(b.img, smooth(sweep));
      } else {
        tmpColor.lerp(amber, 0.9);
      }
    }
    mesh.setColorAt(i, tmpColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;

  renderer.render(scene, camera);
}
requestAnimationFrame(tick);

// ---------- boot / modals ----------
function beginDaily() {
  mode = 'daily';
  startRound(`vantage-${dayNum}`, ` #${dayNum}`);
}
function beginEndless() {
  mode = 'endless';
  endlessCount++;
  startRound(`vantage-endless-${dayNum}-${endlessCount}-${Math.floor(Math.random() * 1e9)}`, ' ∞');
}

$('startbtn').addEventListener('click', () => {
  $('intro').classList.remove('show');
  beginDaily();
});
$('sharebtn').addEventListener('click', async () => {
  const txt = shareText();
  try {
    if (navigator.share) await navigator.share({ text: txt });
    else { await navigator.clipboard.writeText(txt); $('sharefeedback').textContent = 'Copied to clipboard!'; }
  } catch { $('sharefeedback').textContent = txt; }
});
$('admirebtn').addEventListener('click', () => $('solved').classList.remove('show'));
$('endlessbtn').addEventListener('click', beginEndless);

// countdown to next daily
setInterval(() => {
  const el = $('countdown');
  if (!el) return;
  const next = EPOCH + dayNum * 86400000;
  const ms = next - Date.now();
  if (ms > 0 && mode === 'daily') {
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    el.textContent = `Next puzzle in ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } else el.textContent = '';
}, 1000);

// first visit → intro; already solved today → straight to results
{
  const d = store.get();
  currentSeed = `vantage-${dayNum}`;
  loadPuzzle(currentSeed);                  // preload so the intro has a live backdrop
  randomStartAngle(mulberry32(hashStr(`vantage-${dayNum}:s`)));
  $('puzzleno').textContent = ` #${dayNum}`;
  if (d.results && d.results[dayNum]) {
    // already solved today
    mode = 'daily';
    solveT = d.results[dayNum].time;
    hintsUsed = d.results[dayNum].hints;
    state = S.SOLVED;
    revealT = performance.now() / 1000;
    cam.az = puzzle.az; cam.el = puzzle.el;
    $('answeremoji').textContent = puzzle.emoji;
    $('answername').textContent = puzzle.name;
    $('stat-time').textContent = fmtTime(solveT);
    $('stat-hints').textContent = hintsUsed;
    $('stat-streak').textContent = `${d.streak || 1}🔥`;
    $('solved').classList.add('show');
  } else {
    $('intro').classList.add('show');
  }
}

// ---------- debug hooks (for automated testing) ----------
window.VNT = {
  get state() { return state; },
  get puzzle() { return puzzle ? { emoji: puzzle.emoji, name: puzzle.name, az: puzzle.az, el: puzzle.el, count: COUNT } : null; },
  get angDeg() { return puzzle ? THREE.MathUtils.radToDeg(angDistTo(puzzle.az, puzzle.el)) : null; },
  setAngle(az, el) { cam.az = az; cam.el = el; cam.vaz = cam.vel = 0; },
  get cam() { return { az: cam.az, el: cam.el }; },
  beginDaily, beginEndless,
};
