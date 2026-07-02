// ── Declarative configuration ────────────────────────────────────────────────

/** @typedef {{ x: number, y: number }} Vec2 */

/** @typedef {{ position: Vec2, velocity: Vec2, radius: number, color: string, age: number, lifespan: number }} Particle */

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

/** Global physics constants. g_y pulls particles downward: a_y = g_y */
const physicsConfig = {
  gravity: 80,
  maxParticles: 2000,
};

// ── Physics engine state (decoupled from rendering) ──────────────────────────

/** @type {Particle[]} */
const particles = [];

/** Accumulated spawn timer in seconds */
let spawnAccumulator = 0;

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
 * Integrate particle motion for one timestep.
 * v += a·dt,  p += v·dt  where a_y = g (constant downward acceleration)
 * @param {number} dt - delta time in seconds
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
function updatePhysics(dt, canvasWidth, canvasHeight) {
  const centerX = canvasWidth * 0.5;
  const centerY = canvasHeight * 0.5;
  const g_y = physicsConfig.gravity;

  spawnAccumulator += dt;
  const spawnInterval = 1 / emitterConfig.spawnRate;

  while (spawnAccumulator >= spawnInterval) {
    spawnParticle(centerX, centerY);
    spawnAccumulator -= spawnInterval;
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    p.velocity.y += g_y * dt;
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
  bindRange('gravity', 'gravityValue', (v) => { physicsConfig.gravity = v; });
  bindRange('lifespan', 'lifespanValue', (v) => { emitterConfig.lifespan = v; }, parseFloat);

  const colorInput = /** @type {HTMLInputElement} */ (document.getElementById('particleColor'));
  colorInput.addEventListener('input', () => {
    emitterConfig.color = colorInput.value;
  });

  document.getElementById('clearBtn').addEventListener('click', clearParticles);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('resize', resizeCanvas);

initUI();
resizeCanvas();
requestAnimationFrame((ts) => {
  lastTimestamp = ts;
  loop(ts);
});
