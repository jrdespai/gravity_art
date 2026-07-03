import { ASSET_TYPES, getAssetRenderer, setDesignerSprite } from './assetInjector.js';
import { initSpriteDesigner } from './spriteDesigner.js';

// ── Declarative configuration ────────────────────────────────────────────────

/** @typedef {{ x: number, y: number }} Vec2 */

/** @typedef {'burst' | 'stream' | 'edge-rain'} EmitterStyle */

/** @typedef {{ position: Vec2, velocity: Vec2, radius: number, color: string, age: number, lifespan: number, angle: number, angularVelocity: number }} Particle */

/** @typedef {'attractive' | 'repulsive'} AnchorMode */

/** @typedef {{ position: Vec2, mass: number, radius: number, mode: AnchorMode, baseMass: number, baseRadius: number }} OrbitalAnchor */

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
  massScaleMin: 0.35,
  massScaleMax: 3.5,
  /** Scroll-wheel mass adjustment per notch (normalized scale delta) */
  massScrollStep: 0.08,
};

/** Per-mode anchor appearance — attractive pulls (blue/green), repulsive pushes (red/pink) */
const ANCHOR_APPEARANCE = {
  attractive: {
    color: '#4ade80',
    glowColor: 'rgba(74, 222, 128, 0.28)',
    fieldRgb: '74, 222, 128',
    highlight: '#6ee7ff',
  },
  repulsive: {
    color: '#f472b6',
    glowColor: 'rgba(244, 114, 182, 0.28)',
    fieldRgb: '244, 114, 182',
    highlight: '#ef4444',
  },
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

/** Elapsed simulation time in seconds — drives field-line ripple animation */
let simTime = 0;

/** Index of the anchor selected for mass scroll / visual indicator (-1 = none) */
let selectedAnchorIndex = -1;

/** Pointer interaction state for drag, spawn, resize, and double-click toggle */
const pointerState = {
  activePointerId: null,
  mode: /** @type {'none' | 'move' | 'resize-bar' | 'pinch'} */ ('none'),
  downAnchorIndex: -1,
  dragOffset: /** @type {Vec2} */ ({ x: 0, y: 0 }),
  downCanvasPos: /** @type {Vec2} */ ({ x: 0, y: 0 }),
  hasMoved: false,
  lastClickAnchorIndex: -1,
  lastClickTime: 0,
};

/** Live pointer positions — enables two-finger pinch resize on touch devices */
const activePointers = new Map();

/** Pinch gesture baseline when two fingers rest on an anchor */
const pinchState = {
  anchorIndex: -1,
  startDistance: 0,
  startScale: 1,
};

const DRAG_THRESHOLD_PX = 6;
const DOUBLE_CLICK_MS = 350;

/** Unit mass for emitter particles (m₁ in F = G·m₁·m₂/r²) */
const PARTICLE_MASS = 1;

/**
 * @param {AnchorMode} mode
 * @returns {{ color: string, glowColor: string, fieldRgb: string, highlight: string }}
 */
function getAnchorAppearance(mode) {
  return ANCHOR_APPEARANCE[mode];
}

/**
 * Normalized mass scale relative to anchorConfig defaults.
 * @param {OrbitalAnchor} anchor
 * @returns {number}
 */
function getAnchorMassScale(anchor) {
  return anchor.mass / anchor.baseMass;
}

/**
 * Apply a normalized mass scale — radius grows proportionally so strength ∝ mass.
 * @param {OrbitalAnchor} anchor
 * @param {number} scale
 */
function setAnchorMassScale(anchor, scale) {
  const clamped = Math.max(anchorConfig.massScaleMin, Math.min(anchorConfig.massScaleMax, scale));
  anchor.mass = anchor.baseMass * clamped;
  anchor.radius = anchor.baseRadius * clamped;
}

/**
 * Find topmost anchor under canvas coordinates (CSS pixels).
 * @param {number} x
 * @param {number} y
 * @returns {number} anchor index or -1
 */
function hitTestAnchor(x, y) {
  for (let i = anchors.length - 1; i >= 0; i--) {
    const anchor = anchors[i];
    const hitRadius = anchor.radius * 2.4;
    if (Math.hypot(x - anchor.position.x, y - anchor.position.y) <= hitRadius) {
      return i;
    }
  }
  return -1;
}

/**
 * @param {PointerEvent} event
 * @returns {Vec2}
 */
function pointerToCanvas(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

/**
 * Toggle attractive ↔ repulsive on double-click.
 * @param {number} anchorIndex
 */
function toggleAnchorMode(anchorIndex) {
  const anchor = anchors[anchorIndex];
  if (!anchor) return;
  anchor.mode = anchor.mode === 'attractive' ? 'repulsive' : 'attractive';
}

/**
 * @param {number} anchorIndex
 * @param {number} deltaY - wheel delta (positive = scroll down)
 */
function adjustAnchorMass(anchorIndex, deltaY) {
  const anchor = anchors[anchorIndex];
  if (!anchor) return;

  const direction = deltaY > 0 ? -1 : 1;
  const currentScale = getAnchorMassScale(anchor);
  setAnchorMassScale(anchor, currentScale + direction * anchorConfig.massScrollStep);
}

/**
 * Layout for the mass scale bar beside a selected anchor.
 * @param {OrbitalAnchor} anchor
 * @returns {{ barX: number, barY: number, barWidth: number, barHeight: number, touchX: number, touchY: number, touchWidth: number, touchHeight: number, knobX: number, knobY: number, knobRadius: number }}
 */
function getMassIndicatorLayout(anchor) {
  const barHeight = anchor.radius * 2.4;
  const barWidth = 4;
  const gap = anchor.radius + 10;
  const barX = anchor.position.x + gap;
  const barY = anchor.position.y - barHeight * 0.5;
  const touchPadding = 14;
  const normalized =
    (getAnchorMassScale(anchor) - anchorConfig.massScaleMin) /
    (anchorConfig.massScaleMax - anchorConfig.massScaleMin);
  const knobRadius = 7;
  const knobX = barX + barWidth * 0.5;
  const knobY = barY + barHeight - normalized * barHeight;

  return {
    barX,
    barY,
    barWidth,
    barHeight,
    touchX: barX - touchPadding,
    touchY: barY - touchPadding,
    touchWidth: barWidth + touchPadding * 2,
    touchHeight: barHeight + touchPadding * 2,
    knobX,
    knobY,
    knobRadius,
  };
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {number} selected anchor index if mass bar hit, else -1
 */
function hitTestMassIndicator(x, y) {
  if (selectedAnchorIndex < 0) return -1;

  const anchor = anchors[selectedAnchorIndex];
  if (!anchor) return -1;

  const layout = getMassIndicatorLayout(anchor);
  if (
    x >= layout.touchX &&
    x <= layout.touchX + layout.touchWidth &&
    y >= layout.touchY &&
    y <= layout.touchY + layout.touchHeight
  ) {
    return selectedAnchorIndex;
  }

  return -1;
}

/**
 * Map a canvas Y coordinate on the mass bar to anchor mass scale.
 * @param {number} anchorIndex
 * @param {number} canvasY
 */
function setAnchorMassFromBarY(anchorIndex, canvasY) {
  const anchor = anchors[anchorIndex];
  if (!anchor) return;

  const { barY, barHeight } = getMassIndicatorLayout(anchor);
  const normalized = 1 - (canvasY - barY) / barHeight;
  const scale =
    anchorConfig.massScaleMin +
    Math.max(0, Math.min(1, normalized)) * (anchorConfig.massScaleMax - anchorConfig.massScaleMin);
  setAnchorMassScale(anchor, scale);
}

/**
 * @param {number} anchorIndex
 * @returns {Array<{ id: number, x: number, y: number }>}
 */
function getPointersNearAnchor(anchorIndex) {
  const anchor = anchors[anchorIndex];
  if (!anchor) return [];

  const hitRadius = anchor.radius * 3.2;
  const near = [];

  for (const [id, pos] of activePointers) {
    if (Math.hypot(pos.x - anchor.position.x, pos.y - anchor.position.y) <= hitRadius) {
      near.push({ id, x: pos.x, y: pos.y });
    }
  }

  return near;
}

/**
 * Begin pinch-resize when two fingers land on the same anchor.
 * @returns {boolean}
 */
function tryStartPinchResize() {
  for (let i = anchors.length - 1; i >= 0; i--) {
    const near = getPointersNearAnchor(i);
    if (near.length < 2) continue;

    const [a, b] = near;
    pinchState.anchorIndex = i;
    pinchState.startDistance = Math.hypot(b.x - a.x, b.y - a.y);
    pinchState.startScale = getAnchorMassScale(anchors[i]);
    pointerState.mode = 'pinch';
    pointerState.downAnchorIndex = i;
    pointerState.hasMoved = true;
    selectedAnchorIndex = i;
    return true;
  }

  return false;
}

/**
 * Apply live pinch distance to anchor mass.
 */
function updatePinchResize() {
  if (pinchState.anchorIndex < 0) return;

  const near = getPointersNearAnchor(pinchState.anchorIndex);
  if (near.length < 2) return;

  const [a, b] = near;
  const currentDistance = Math.hypot(b.x - a.x, b.y - a.y);
  if (pinchState.startDistance < 1e-3) return;

  const ratio = currentDistance / pinchState.startDistance;
  setAnchorMassScale(anchors[pinchState.anchorIndex], pinchState.startScale * ratio);
}

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

    // F = G · (m₁ · m₂) / r²  →  |F| clamped; sign flips for repulsive anchors
    let forceMag = (G * PARTICLE_MASS * anchor.mass) / rEffSq;
    forceMag = Math.min(forceMag, maxForce);

    const sign = anchor.mode === 'repulsive' ? -1 : 1;
    const dirX = dx / r;
    const dirY = dy / r;

    ax += sign * (dirX * forceMag) / PARTICLE_MASS;
    ay += sign * (dirY * forceMag) / PARTICLE_MASS;
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
    mode: 'attractive',
    baseMass: anchorConfig.mass,
    baseRadius: anchorConfig.radius,
  });
  selectedAnchorIndex = anchors.length - 1;
}

function clearAnchors() {
  anchors.length = 0;
  selectedAnchorIndex = -1;
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
 * Subtle concentric ripples — visualizes the gravitational warp field for kids.
 * @param {CanvasRenderingContext2D} ctx
 * @param {OrbitalAnchor} anchor
 * @param {number} time
 */
function drawFieldLines(ctx, anchor, time) {
  const { x, y } = anchor.position;
  const appearance = getAnchorAppearance(anchor.mode);
  const ringCount = 5;
  const spacing = anchor.radius * 1.6;
  const pulseSpeed = anchor.mode === 'repulsive' ? 0.55 : 0.4;

  ctx.save();
  ctx.lineWidth = 1;

  for (let i = 0; i < ringCount; i++) {
    const phase = (time * pulseSpeed + i * 0.22) % 1;
    const radius = anchor.radius * 1.8 + spacing * (i + 0.35 + phase);
    const alpha = 0.14 * (1 - i / ringCount) * (0.65 + 0.35 * Math.sin(time * 2 + i));
    ctx.strokeStyle = `rgba(${appearance.fieldRgb}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draggable mass scale bar beside a selected anchor (scroll wheel + touch drag).
 * @param {CanvasRenderingContext2D} ctx
 * @param {OrbitalAnchor} anchor
 */
function drawMassIndicator(ctx, anchor) {
  const scale = getAnchorMassScale(anchor);
  const normalized =
    (scale - anchorConfig.massScaleMin) / (anchorConfig.massScaleMax - anchorConfig.massScaleMin);
  const layout = getMassIndicatorLayout(anchor);
  const fillHeight = layout.barHeight * normalized;

  ctx.save();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(layout.barX, layout.barY, layout.barWidth, layout.barHeight);

  const appearance = getAnchorAppearance(anchor.mode);
  ctx.fillStyle = appearance.highlight;
  ctx.fillRect(layout.barX, layout.barY + layout.barHeight - fillHeight, layout.barWidth, fillHeight);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.barX + 0.5, layout.barY + 0.5, layout.barWidth - 1, layout.barHeight - 1);

  ctx.fillStyle = appearance.highlight;
  ctx.beginPath();
  ctx.arc(layout.knobX, layout.knobY, layout.knobRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {OrbitalAnchor} anchor
 * @param {boolean} isSelected
 */
function drawAnchor(ctx, anchor, isSelected) {
  const { x, y } = anchor.position;
  const appearance = getAnchorAppearance(anchor.mode);
  const glowRadius = anchor.radius * 2.2;

  drawFieldLines(ctx, anchor, simTime);

  ctx.fillStyle = appearance.glowColor;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  if (isSelected) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, anchor.radius + 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = appearance.color;
  ctx.beginPath();
  ctx.arc(x, y, anchor.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = appearance.highlight;
  ctx.beginPath();
  ctx.arc(x - anchor.radius * 0.25, y - anchor.radius * 0.25, anchor.radius * 0.22, 0, Math.PI * 2);
  ctx.fill();

  if (isSelected) {
    drawMassIndicator(ctx, anchor);
  }
}

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

  for (let i = 0; i < anchors.length; i++) {
    drawAnchor(ctx, anchors[i], i === selectedAnchorIndex);
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

  simTime += dt;
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

  initCanvasInteraction();

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

// ── Canvas pointer interaction (drag, spawn, toggle, mass scroll) ─────────────

/**
 * @param {number} x
 * @param {number} y
 */
function updateCanvasCursor(x, y) {
  if (pointerState.activePointerId !== null) {
    if (pointerState.mode === 'resize-bar') {
      canvas.style.cursor = 'ns-resize';
    } else if (pointerState.mode === 'pinch') {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = pointerState.downAnchorIndex >= 0 ? 'grabbing' : 'crosshair';
    }
    return;
  }

  if (hitTestMassIndicator(x, y) >= 0) {
    canvas.style.cursor = 'ns-resize';
    return;
  }

  canvas.style.cursor = hitTestAnchor(x, y) >= 0 ? 'grab' : 'crosshair';
}

function resetPointerGesture() {
  pointerState.activePointerId = null;
  pointerState.mode = 'none';
  pointerState.downAnchorIndex = -1;
  pointerState.hasMoved = false;
  pinchState.anchorIndex = -1;
  pinchState.startDistance = 0;
  pinchState.startScale = 1;
}

function initCanvasInteraction() {
  canvas.addEventListener('pointerdown', (event) => {
    const pos = pointerToCanvas(event);
    activePointers.set(event.pointerId, pos);

    if (tryStartPinchResize()) {
      if (pointerState.activePointerId !== null && canvas.hasPointerCapture(pointerState.activePointerId)) {
        canvas.releasePointerCapture(pointerState.activePointerId);
      }
      pointerState.activePointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      updateCanvasCursor(pos.x, pos.y);
      return;
    }

    if (pointerState.activePointerId !== null) return;

    const massBarIndex = hitTestMassIndicator(pos.x, pos.y);
    const anchorIndex = massBarIndex >= 0 ? massBarIndex : hitTestAnchor(pos.x, pos.y);

    pointerState.activePointerId = event.pointerId;
    pointerState.downAnchorIndex = anchorIndex;
    pointerState.downCanvasPos = pos;
    pointerState.hasMoved = false;
    pointerState.mode = massBarIndex >= 0 ? 'resize-bar' : anchorIndex >= 0 ? 'move' : 'none';

    if (anchorIndex >= 0) {
      selectedAnchorIndex = anchorIndex;
      if (pointerState.mode === 'move') {
        const anchor = anchors[anchorIndex];
        pointerState.dragOffset = {
          x: anchor.position.x - pos.x,
          y: anchor.position.y - pos.y,
        };
      }
      canvas.setPointerCapture(event.pointerId);
    }

    updateCanvasCursor(pos.x, pos.y);
  });

  canvas.addEventListener('pointermove', (event) => {
    const pos = pointerToCanvas(event);
    activePointers.set(event.pointerId, pos);

    if (pointerState.mode === 'pinch') {
      updatePinchResize();
      updateCanvasCursor(pos.x, pos.y);
      return;
    }

    if (activePointers.size >= 2 && tryStartPinchResize()) {
      updatePinchResize();
      updateCanvasCursor(pos.x, pos.y);
      return;
    }

    if (event.pointerId !== pointerState.activePointerId) {
      updateCanvasCursor(pos.x, pos.y);
      return;
    }

    if (pointerState.mode === 'resize-bar' && pointerState.downAnchorIndex >= 0) {
      pointerState.hasMoved = true;
      setAnchorMassFromBarY(pointerState.downAnchorIndex, pos.y);
      updateCanvasCursor(pos.x, pos.y);
      return;
    }

    if (pointerState.mode === 'move' && pointerState.downAnchorIndex >= 0) {
      const moved = Math.hypot(
        pos.x - pointerState.downCanvasPos.x,
        pos.y - pointerState.downCanvasPos.y,
      );

      if (moved >= DRAG_THRESHOLD_PX) {
        pointerState.hasMoved = true;
      }

      if (pointerState.hasMoved) {
        const anchor = anchors[pointerState.downAnchorIndex];
        anchor.position.x = pos.x + pointerState.dragOffset.x;
        anchor.position.y = pos.y + pointerState.dragOffset.y;
      }
    }

    updateCanvasCursor(pos.x, pos.y);
  });

  const finishPointer = (event) => {
    activePointers.delete(event.pointerId);

    if (pointerState.mode === 'pinch') {
      if (activePointers.size >= 2) {
        tryStartPinchResize();
        updateCanvasCursor(pointerToCanvas(event).x, pointerToCanvas(event).y);
        return;
      }

      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      resetPointerGesture();
      updateCanvasCursor(pointerToCanvas(event).x, pointerToCanvas(event).y);
      return;
    }

    if (event.pointerId !== pointerState.activePointerId) return;

    const pos = pointerToCanvas(event);
    const anchorIndex = pointerState.downAnchorIndex;
    const now = performance.now();

    if (pointerState.mode === 'move' && anchorIndex >= 0 && !pointerState.hasMoved) {
      const isDoubleClick =
        pointerState.lastClickAnchorIndex === anchorIndex &&
        now - pointerState.lastClickTime <= DOUBLE_CLICK_MS;

      if (isDoubleClick) {
        toggleAnchorMode(anchorIndex);
        pointerState.lastClickAnchorIndex = -1;
        pointerState.lastClickTime = 0;
      } else {
        pointerState.lastClickAnchorIndex = anchorIndex;
        pointerState.lastClickTime = now;
        selectedAnchorIndex = anchorIndex;
      }
    } else if (pointerState.mode === 'none' && anchorIndex < 0 && !pointerState.hasMoved) {
      addOrbitalAnchor(pos.x, pos.y);
    } else if (pointerState.mode === 'resize-bar' && anchorIndex >= 0) {
      selectedAnchorIndex = anchorIndex;
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    resetPointerGesture();
    updateCanvasCursor(pos.x, pos.y);
  };

  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', finishPointer);

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const pos = pointerToCanvas(event);
    const hoverIndex = hitTestAnchor(pos.x, pos.y);
    const targetIndex = hoverIndex >= 0 ? hoverIndex : selectedAnchorIndex;
    if (targetIndex < 0) return;

    selectedAnchorIndex = targetIndex;
    adjustAnchorMass(targetIndex, event.deltaY);
  }, { passive: false });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('resize', resizeCanvas);

initUI();
resizeCanvas();
requestAnimationFrame((ts) => {
  lastTimestamp = ts;
  loop(ts);
});
