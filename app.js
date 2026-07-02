// ── Declarative configuration ────────────────────────────────────────────────

/** @typedef {{ x: number, y: number }} Vec2 */

/** @typedef {{ position: Vec2, velocity: Vec2, radius: number, color: string, age: number, lifespan: number }} Particle */

/** @typedef {{ position: Vec2, mass: number, radius: number }} OrbitalAnchor */

/**
 * Emitter spawns particles at the canvas center with randomized initial velocities.
 * @type {{
 *   spawnRate: number,
 *   speedMin: number,
 *   speedMax: number,
 *   radius: number,
 *   color: string,
 *   lifespan: number,
 * }}
 */
const emitterConfig = {
  spawnRate: 8,
  speedMin: 40,
  speedMax: 120,
  radius: 3,
  color: '#6ee7ff',
  lifespan: 4,
};

/**
 * Global physics constants.
 * G scales Newtonian attraction: F = G · (m₁ · m₂) / r²
 * softening clamps r so force stays finite near anchors.
 */
const physicsConfig = {
  G: 500,
  softening: 10,
  maxForce: 12000,
  maxParticles: 2000,
};

/** Visual + mass defaults for user-placed gravitational nodes */
const anchorConfig = {
  mass: 800,
  radius: 14,
  color: '#ffd166',
  glowColor: 'rgba(255, 209, 102, 0.25)',
};

// ── Physics engine state (decoupled from rendering) ──────────────────────────

/** @type {Particle[]} */
const particles = [];

/** @type {OrbitalAnchor[]} */
const anchors = [];

/** Accumulated spawn timer in seconds */
let spawnAccumulator = 0;

/** Unit mass for emitter particles (m₁ in F = G·m₁·m₂/r²) */
const PARTICLE_MASS = 1;

/**
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Spawn one particle at the given center with a random direction and speed.
 * @param {number} centerX
 * @param {number} centerY
 */
function spawnParticle(centerX, centerY) {
  if (particles.length >= physicsConfig.maxParticles) return;

  const angle = randomRange(0, Math.PI * 2);
  const speed = randomRange(emitterConfig.speedMin, emitterConfig.speedMax);

  /** @type {Particle} */
  const particle = {
    position: { x: centerX, y: centerY },
    velocity: {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    },
    radius: emitterConfig.radius,
    color: emitterConfig.color,
    age: 0,
    lifespan: emitterConfig.lifespan,
  };

  particles.push(particle);
}

/**
 * Newtonian pull from every anchor: a = F/m₁ = G·m₂/r_eff² toward anchor.
 * r_eff = max(r, softening) prevents the r→0 singularity ("hyperspace slingshot").
 * @param {Particle} particle
 * @returns {Vec2}
 */
function computeAnchorAcceleration(particle) {
  let ax = 0;
  let ay = 0;
  const G = physicsConfig.G;
  const softening = physicsConfig.softening;
  const maxForce = physicsConfig.maxForce;

  for (const anchor of anchors) {
    const dx = anchor.position.x - particle.position.x;
    const dy = anchor.position.y - particle.position.y;
    const r = Math.hypot(dx, dy);

    if (r < 1e-6) continue;

    const rEff = Math.max(r, softening);
    const rEffSq = rEff * rEff;

    // F = G · (m₁ · m₂) / r²  →  |F| clamped, direction toward anchor
    let forceMag = (G * PARTICLE_MASS * anchor.mass) / rEffSq;
    forceMag = Math.min(forceMag, maxForce);

    const dirX = dx / r;
    const dirY = dy / r;

    ax += (dirX * forceMag) / PARTICLE_MASS;
    ay += (dirY * forceMag) / PARTICLE_MASS;
  }

  return { x: ax, y: ay };
}

/**
 * @param {number} x
 * @param {number} y
 */
function addOrbitalAnchor(x, y) {
  anchors.push({
    position: { x, y },
    mass: anchorConfig.mass,
    radius: anchorConfig.radius,
  });
}

function clearAnchors() {
  anchors.length = 0;
}

/**
 * Integrate particle motion for one timestep.
 * v += a·dt,  p += v·dt  where a comes from all Orbital Anchors
 * @param {number} dt - delta time in seconds
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
function updatePhysics(dt, canvasWidth, canvasHeight) {
  const centerX = canvasWidth * 0.5;
  const centerY = canvasHeight * 0.5;

  spawnAccumulator += dt;
  const spawnInterval = 1 / emitterConfig.spawnRate;

  while (spawnAccumulator >= spawnInterval) {
    spawnParticle(centerX, centerY);
    spawnAccumulator -= spawnInterval;
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    const accel = computeAnchorAcceleration(p);
    p.velocity.x += accel.x * dt;
    p.velocity.y += accel.y * dt;
    p.position.x += p.velocity.x * dt;
    p.position.y += p.velocity.y * dt;
    p.age += dt;

    const outOfBounds =
      p.position.x < -p.radius ||
      p.position.x > canvasWidth + p.radius ||
      p.position.y < -p.radius ||
      p.position.y > canvasHeight + p.radius;

    if (p.age >= p.lifespan || outOfBounds) {
      particles.splice(i, 1);
    }
  }
}

/**
 * Scale all particle positions when the canvas is resized so coordinates stay proportional.
 * @param {number} scaleX
 * @param {number} scaleY
 */
function scaleParticlePositions(scaleX, scaleY) {
  for (const p of particles) {
    p.position.x *= scaleX;
    p.position.y *= scaleY;
    p.velocity.x *= scaleX;
    p.velocity.y *= scaleY;
  }

  for (const anchor of anchors) {
    anchor.position.x *= scaleX;
    anchor.position.y *= scaleY;
  }
}

function clearParticles() {
  particles.length = 0;
  spawnAccumulator = 0;
}

// ── Render phase (reads physics state, never mutates it) ───────────────────────

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 */
function render(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(110, 231, 255, 0.04)';
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.5, 6, 0, Math.PI * 2);
  ctx.fill();

  for (const anchor of anchors) {
    const { x, y } = anchor.position;
    const glowRadius = anchor.radius * 2.2;

    ctx.fillStyle = anchorConfig.glowColor;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = anchorConfig.color;
    ctx.beginPath();
    ctx.arc(x, y, anchor.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(x - anchor.radius * 0.25, y - anchor.radius * 0.25, anchor.radius * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of particles) {
    const alpha = Math.max(0, 1 - p.age / p.lifespan);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.position.x, p.position.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

// ── Canvas sizing ─────────────────────────────────────────────────────────────

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

let canvasWidth = 0;
let canvasHeight = 0;
let devicePixelRatio = 1;

function resizeCanvas() {
  const stage = canvas.parentElement;
  if (!stage) return;

  const cssWidth = stage.clientWidth;
  const cssHeight = stage.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  if (canvasWidth > 0 && canvasHeight > 0) {
    const scaleX = cssWidth / canvasWidth;
    const scaleY = cssHeight / canvasHeight;
    scaleParticlePositions(scaleX, scaleY);
  }

  canvasWidth = cssWidth;
  canvasHeight = cssHeight;
  devicePixelRatio = dpr;

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Game loop (delta-time rAF) ────────────────────────────────────────────────

let lastTimestamp = 0;
let fpsAccumulator = 0;
let fpsFrameCount = 0;
let displayedFps = 0;

const MAX_DELTA = 1 / 30;

/**
 * @param {DOMHighResTimeStamp} timestamp
 */
function loop(timestamp) {
  const rawDt = lastTimestamp > 0 ? (timestamp - lastTimestamp) / 1000 : 0;
  lastTimestamp = timestamp;
  const dt = Math.min(rawDt, MAX_DELTA);

  updatePhysics(dt, canvasWidth, canvasHeight);
  render(ctx, canvasWidth, canvasHeight);

  fpsFrameCount++;
  fpsAccumulator += dt;
  if (fpsAccumulator >= 0.5) {
    displayedFps = Math.round(fpsFrameCount / fpsAccumulator);
    fpsFrameCount = 0;
    fpsAccumulator = 0;
    document.getElementById('fps').textContent = String(displayedFps);
  }

  document.getElementById('particleCount').textContent = String(particles.length);
  document.getElementById('anchorCount').textContent = String(anchors.length);

  requestAnimationFrame(loop);
}

// ── Sidebar UI bindings ───────────────────────────────────────────────────────

/**
 * @param {string} inputId
 * @param {string} outputId
 * @param {(value: number) => void} onChange
 * @param {(raw: string) => number} [parse]
 */
function bindRange(inputId, outputId, onChange, parse = Number) {
  const input = /** @type {HTMLInputElement} */ (document.getElementById(inputId));
  const output = /** @type {HTMLOutputElement} */ (document.getElementById(outputId));

  const apply = () => {
    const value = parse(input.value);
    output.textContent = input.step.includes('.') ? value.toFixed(1) : String(value);
    onChange(value);
  };

  input.addEventListener('input', apply);
  apply();
}

function initUI() {
  bindRange('spawnRate', 'spawnRateValue', (v) => { emitterConfig.spawnRate = v; });
  bindRange('speedMin', 'speedMinValue', (v) => {
    emitterConfig.speedMin = v;
    if (emitterConfig.speedMax < v) emitterConfig.speedMax = v;
  });
  bindRange('speedMax', 'speedMaxValue', (v) => {
    emitterConfig.speedMax = v;
    if (emitterConfig.speedMin > v) emitterConfig.speedMin = v;
  });
  bindRange('particleSize', 'particleSizeValue', (v) => { emitterConfig.radius = v; });
  bindRange('gravityG', 'gravityGValue', (v) => { physicsConfig.G = v; });
  bindRange('lifespan', 'lifespanValue', (v) => { emitterConfig.lifespan = v; }, parseFloat);

  const colorInput = /** @type {HTMLInputElement} */ (document.getElementById('particleColor'));
  colorInput.addEventListener('input', () => {
    emitterConfig.color = colorInput.value;
  });

  document.getElementById('clearBtn').addEventListener('click', clearParticles);
  document.getElementById('clearAnchorsBtn').addEventListener('click', clearAnchors);

  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    addOrbitalAnchor(event.clientX - rect.left, event.clientY - rect.top);
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('resize', resizeCanvas);

initUI();
resizeCanvas();
requestAnimationFrame((ts) => {
  lastTimestamp = ts;
  loop(ts);
});
