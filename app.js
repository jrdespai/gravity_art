import { ASSET_TYPES, getAssetRenderer, setDesignerSprite } from './assetInjector.js';
import { initSpriteDesigner } from './spriteDesigner.js';

// ── Declarative configuration ────────────────────────────────────────────────

/** @typedef {{ x: number, y: number }} Vec2 */

/** @typedef {'burst' | 'stream' | 'edge-rain'} EmitterStyle */

/** @typedef {{ position: Vec2, velocity: Vec2, radius: number, color: string, age: number, lifespan: number, angle: number, angularVelocity: number }} Particle */

/** @typedef {{ position: Vec2, mass: number, radius: number }} OrbitalAnchor */

/** @typedef {{
 *   id: string,
 *   name: string,
 *   spawnRate: number,
 *   speedMin: number,
 *   speedMax: number,
 *   radius: number,
 *   lifespan: number,
 *   emitterStyle: EmitterStyle,
 *   palette: string[],
 *   assetType: import('./assetInjector.js').AssetType,
 *   gravityG: number,
 * }} StylePreset */

/** @type {StylePreset[]} */
const STYLE_PRESETS = [
  {
    id: 'neon-galaxy',
    name: 'Neon Galaxy',
    spawnRate: 14,
    speedMin: 50,
    speedMax: 140,
    radius: 3.5,
    lifespan: 5,
    emitterStyle: 'burst',
    palette: ['#6ee7ff', '#c084fc', '#f472b6', '#818cf8'],
    assetType: ASSET_TYPES.circle,
    gravityG: 600,
  },
  {
    id: 'volcanic-inversion',
    name: 'Volcanic Inversion',
    spawnRate: 18,
    speedMin: 30,
    speedMax: 100,
    radius: 4,
    lifespan: 3,
    emitterStyle: 'stream',
    palette: ['#ff6b35', '#f7931e', '#ffd166', '#ef4444'],
    assetType: ASSET_TYPES.square,
    gravityG: 800,
  },
  {
    id: 'retro-pixel-sparkles',
    name: 'Retro Pixel Sparkles',
    spawnRate: 24,
    speedMin: 60,
    speedMax: 180,
    radius: 2.5,
    lifespan: 2.5,
    emitterStyle: 'edge-rain',
    palette: ['#22c55e', '#eab308', '#06b6d4', '#ec4899'],
    assetType: ASSET_TYPES.pixel,
    gravityG: 400,
  },
];

/**
 * Live emitter + visual settings — sidebar controls write here;
 * only newly spawned particles read these values.
 * @type {{
 *   spawnRate: number,
 *   speedMin: number,
 *   speedMax: number,
 *   radius: number,
 *   lifespan: number,
 *   emitterStyle: EmitterStyle,
 *   palette: string[],
 *   assetType: import('./assetInjector.js').AssetType,
 *   particleSpin: number,
 * }}
 */
const emitterConfig = {
  spawnRate: 8,
  speedMin: 40,
  speedMax: 120,
  radius: 3,
  lifespan: 4,
  emitterStyle: /** @type {EmitterStyle} */ ('burst'),
  palette: ['#6ee7ff', '#c084fc', '#f472b6', '#818cf8'],
  assetType: ASSET_TYPES.circle,
  particleSpin: 3,
};

/**
 * Live visual settings — trail persistence and size decay apply to all particles immediately.
 * @type {{ trailOpacityDecay: number, sizeDecay: boolean }}
 */
const visualConfig = {
  trailOpacityDecay: 0.35,
  sizeDecay: false,
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
  maxParticles: 3000,
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

/** Active asset renderer — swapped via sidebar or preset */
let activeAssetRenderer = getAssetRenderer(ASSET_TYPES.circle);

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
 * Pick a random color from the active palette.
 * @returns {string}
 */
function pickPaletteColor() {
  const { palette } = emitterConfig;
  if (palette.length === 0) return '#ffffff';
  return palette[Math.floor(Math.random() * palette.length)];
}

/**
 * Compute spawn position + velocity based on emitter style.
 * @param {EmitterStyle} style
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @returns {{ x: number, y: number, vx: number, vy: number }}
 */
function computeSpawnParams(style, canvasWidth, canvasHeight) {
  const centerX = canvasWidth * 0.5;
  const centerY = canvasHeight * 0.5;
  const speed = randomRange(emitterConfig.speedMin, emitterConfig.speedMax);

  switch (style) {
    case 'stream': {
      const y = centerY + randomRange(-canvasHeight * 0.15, canvasHeight * 0.15);
      const angle = randomRange(-0.35, 0.35);
      return {
        x: canvasWidth * 0.08,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      };
    }
    case 'edge-rain': {
      const x = randomRange(0, canvasWidth);
      const angle = randomRange(Math.PI * 0.35, Math.PI * 0.65);
      return {
        x,
        y: -emitterConfig.radius,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      };
    }
    case 'burst':
    default: {
      const angle = randomRange(0, Math.PI * 2);
      return {
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      };
    }
  }
}

/**
 * Spawn one particle using the current emitter config.
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
function spawnParticle(canvasWidth, canvasHeight) {
  if (particles.length >= physicsConfig.maxParticles) return;

  const { x, y, vx, vy } = computeSpawnParams(
    emitterConfig.emitterStyle,
    canvasWidth,
    canvasHeight,
  );

  /** @type {Particle} */
  const particle = {
    position: { x, y },
    velocity: { x: vx, y: vy },
    radius: emitterConfig.radius,
    color: pickPaletteColor(),
    age: 0,
    lifespan: emitterConfig.lifespan,
    angle: randomRange(0, Math.PI * 2),
    angularVelocity: emitterConfig.particleSpin * (Math.random() < 0.5 ? -1 : 1),
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
  spawnAccumulator += dt;
  const spawnInterval = 1 / emitterConfig.spawnRate;

  while (spawnAccumulator >= spawnInterval) {
    spawnParticle(canvasWidth, canvasHeight);
    spawnAccumulator -= spawnInterval;
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    const accel = computeAnchorAcceleration(p);
    p.velocity.x += accel.x * dt;
    p.velocity.y += accel.y * dt;
    p.position.x += p.velocity.x * dt;
    p.position.y += p.velocity.y * dt;
    p.angle += p.angularVelocity * dt;
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
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
}

// ── Render phase (reads physics state, never mutates it) ───────────────────────

/** Canvas background RGB — matches --bg-base for trail fade overlay */
const CANVAS_BG = { r: 13, g: 15, b: 20 };

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 */
function render(ctx, width, height) {
  const { r, g, b } = CANVAS_BG;
  const decay = visualConfig.trailOpacityDecay;

  if (decay >= 1) {
    ctx.clearRect(0, 0, width, height);
  } else {
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${decay})`;
    ctx.fillRect(0, 0, width, height);
  }

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

  const drawAsset = activeAssetRenderer.draw;
  for (const p of particles) {
    const lifeRatio = p.age / p.lifespan;
    const alpha = Math.max(0, 1 - lifeRatio);
    const sizeScale = visualConfig.sizeDecay ? Math.max(0, 1 - lifeRatio) : 1;
    const drawRadius = p.radius * sizeScale;
    drawAsset(ctx, p.position.x, p.position.y, drawRadius, p.color, alpha, p.angle);
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

/**
 * Sync sidebar inputs to reflect current config without firing change handlers.
 * @param {StylePreset} preset
 */
function syncSidebarToConfig(preset) {
  const setRange = (id, value) => {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
    el.value = String(value);
    el.dispatchEvent(new Event('input'));
  };

  setRange('spawnRate', preset.spawnRate);
  setRange('speedMin', preset.speedMin);
  setRange('speedMax', preset.speedMax);
  setRange('particleSize', preset.radius);
  setRange('lifespan', preset.lifespan);
  setRange('gravityG', preset.gravityG);

  const styleInput = /** @type {HTMLInputElement | null} */ (
    document.querySelector(`input[name="emitterStyle"][value="${preset.emitterStyle}"]`)
  );
  if (styleInput) styleInput.checked = true;

  const assetInput = /** @type {HTMLSelectElement} */ (document.getElementById('assetType'));
  assetInput.value = preset.assetType;

  syncPaletteInputs(preset.palette);
}

/**
 * @param {string[]} colors
 */
function syncPaletteInputs(colors) {
  for (let i = 0; i < 4; i++) {
    const input = /** @type {HTMLInputElement} */ (document.getElementById(`palette${i}`));
    input.value = colors[i] ?? '#ffffff';
  }
  emitterConfig.palette = [...colors];
  updatePalettePreview();
}

function updatePalettePreview() {
  const preview = document.getElementById('palettePreview');
  if (!preview) return;
  preview.innerHTML = '';
  for (const color of emitterConfig.palette) {
    const swatch = document.createElement('span');
    swatch.className = 'palette-preview__swatch';
    swatch.style.background = color;
    preview.appendChild(swatch);
  }
}

/**
 * Apply a full style preset to live config + sidebar.
 * @param {string} presetId
 */
function applyPreset(presetId) {
  const preset = STYLE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;

  emitterConfig.spawnRate = preset.spawnRate;
  emitterConfig.speedMin = preset.speedMin;
  emitterConfig.speedMax = preset.speedMax;
  emitterConfig.radius = preset.radius;
  emitterConfig.lifespan = preset.lifespan;
  emitterConfig.emitterStyle = preset.emitterStyle;
  emitterConfig.palette = [...preset.palette];
  emitterConfig.assetType = preset.assetType;
  physicsConfig.G = preset.gravityG;
  activeAssetRenderer = getAssetRenderer(preset.assetType);

  syncSidebarToConfig(preset);
}

function initSidebarTabs() {
  const tabs = document.querySelectorAll('.sidebar-tabs__btn');
  const panels = document.querySelectorAll('.sidebar-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const panelId = /** @type {HTMLElement} */ (tab).dataset.panel;

      tabs.forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle('sidebar-tabs__btn--active', isActive);
        t.setAttribute('aria-selected', String(isActive));
      });

      panels.forEach((panel) => {
        const isActive = panel.id === `panel-${panelId}`;
        panel.classList.toggle('sidebar-panel--active', isActive);
        if (isActive) {
          panel.removeAttribute('hidden');
        } else {
          panel.setAttribute('hidden', '');
        }
      });
    });
  });
}

function initUI() {
  initSidebarTabs();

  const presetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('stylePreset'));
  for (const preset of STYLE_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    presetSelect.appendChild(option);
  }
  presetSelect.addEventListener('change', () => applyPreset(presetSelect.value));

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
  bindRange('particleSpin', 'particleSpinValue', (v) => { emitterConfig.particleSpin = v; }, parseFloat);
  bindRange('trailDecay', 'trailDecayValue', (v) => { visualConfig.trailOpacityDecay = v; }, parseFloat);

  const sizeDecayCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('sizeDecay'));
  sizeDecayCheckbox.addEventListener('change', () => {
    visualConfig.sizeDecay = sizeDecayCheckbox.checked;
  });

  const styleRadios = document.querySelectorAll('input[name="emitterStyle"]');
  styleRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (/** @type {HTMLInputElement} */ (radio).checked) {
        emitterConfig.emitterStyle = /** @type {EmitterStyle} */ (/** @type {HTMLInputElement} */ (radio).value);
      }
    });
  });

  const assetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('assetType'));
  assetSelect.addEventListener('change', () => {
    emitterConfig.assetType = /** @type {import('./assetInjector.js').AssetType} */ (assetSelect.value);
    activeAssetRenderer = getAssetRenderer(emitterConfig.assetType);
  });

  for (let i = 0; i < 4; i++) {
    const input = /** @type {HTMLInputElement} */ (document.getElementById(`palette${i}`));
    input.addEventListener('input', () => {
      emitterConfig.palette[i] = input.value;
      updatePalettePreview();
    });
  }

  document.getElementById('clearBtn').addEventListener('click', clearParticles);
  document.getElementById('clearAnchorsBtn').addEventListener('click', clearAnchors);

  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    addOrbitalAnchor(event.clientX - rect.left, event.clientY - rect.top);
  });

  syncPaletteInputs(emitterConfig.palette);

  initSpriteDesigner({
    onApply: (compiledCanvas) => {
      emitterConfig.assetType = ASSET_TYPES.sprite;
      activeAssetRenderer = setDesignerSprite(compiledCanvas);

      const assetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('assetType'));
      assetSelect.value = ASSET_TYPES.sprite;
    },
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
