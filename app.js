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

// ── Game mode state machine ────────────────────────────────────────────────────

/** @typedef {'sandbox' | 'game'} PlayMode */
/** @typedef {'setup' | 'playing' | 'victory' | 'defeat'} LevelState */

/** @typedef {{
 *   targetPercentage: number,
 *   timeLimit: number,
 *   maxParticles: number,
 *   spawnRate: number,
 *   name: string,
 *   lifespan: number,
 *   speedMin: number,
 *   speedMax: number,
 *   maxAnchors: number,
 *   aimSpread: number,
 *   spawnSpread: number,
 * }} LevelConfig */

/** @typedef {{ x: number, y: number, radius: number }} Portal */

/** @typedef {{ x: number, y: number }} GameEmitter */

/** @typedef {{ x: number, y: number, age: number, maxAge: number, color: string, maxRadius: number }} PortalRipple */

/** @type {LevelConfig[]} */
const LEVELS = [
  { name: 'First Light', targetPercentage: 0.60, timeLimit: 45, maxParticles: 40, spawnRate: 6, lifespan: 24, speedMin: 55, speedMax: 85, maxAnchors: 2, aimSpread: 0.22, spawnSpread: 0.12 },
  { name: 'Orbital Drift', targetPercentage: 0.70, timeLimit: 60, maxParticles: 60, spawnRate: 8, lifespan: 20, speedMin: 50, speedMax: 110, maxAnchors: 3, aimSpread: 0.30, spawnSpread: 0.15 },
  { name: 'Gravity Gate', targetPercentage: 0.80, timeLimit: 75, maxParticles: 80, spawnRate: 10, lifespan: 18, speedMin: 60, speedMax: 130, maxAnchors: 4, aimSpread: 0.38, spawnSpread: 0.18 },
];

/**
 * Unified game state — decoupled from physics arrays.
 * score tracks particles saved through the portal.
 * @type {{
 *   currentMode: PlayMode,
 *   levelIndex: number,
 *   score: number,
 *   targetPercentage: number,
 *   levelState: LevelState,
 *   totalSpawned: number,
 *   elapsedTime: number,
 * }}
 */
const gameState = {
  currentMode: 'sandbox',
  levelIndex: 0,
  score: 0,
  targetPercentage: 0.8,
  levelState: 'playing',
  totalSpawned: 0,
  elapsedTime: 0,
};

/** Portal on the right — particles within radius are absorbed */
/** @type {Portal} */
const portal = { x: 0, y: 0, radius: 48 };

/** Fixed emitter on the left in game mode */
/** @type {GameEmitter} */
const gameEmitter = { x: 0, y: 0 };

/** Dissolve ripples when particles enter the portal */
/** @type {PortalRipple[]} */
const portalRipples = [];

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
 * @returns {LevelConfig}
 */
function getCurrentLevel() {
  return LEVELS[gameState.levelIndex] ?? LEVELS[0];
}

/**
 * Success ratio: Particles Saved / Total Particles Spawned
 * @returns {number}
 */
function getSuccessPercentage() {
  if (gameState.totalSpawned === 0) return 0;
  return gameState.score / gameState.totalSpawned;
}

/**
 * Place portal (right) and emitter (left) using proportional canvas coordinates.
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
function layoutGameObjects(canvasWidth, canvasHeight) {
  const sizeRef = Math.min(canvasWidth, canvasHeight);
  portal.x = canvasWidth * 0.88;
  portal.y = canvasHeight * 0.5;
  portal.radius = sizeRef * 0.07;
  gameEmitter.x = canvasWidth * 0.1;
  gameEmitter.y = canvasHeight * 0.5;
}

/**
 * Game-only no-anchor radius around the portal — blocks portal camping exploit.
 * @returns {number}
 */
function getPortalExclusionRadius() {
  return portal.radius * 1.75;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isInsidePortalExclusionZone(x, y) {
  if (gameState.currentMode !== 'game') return false;
  const dx = x - portal.x;
  const dy = y - portal.y;
  return Math.hypot(dx, dy) < getPortalExclusionRadius();
}

/**
 * Push a position to the nearest point outside the portal exclusion zone.
 * @param {number} x
 * @param {number} y
 * @returns {Vec2}
 */
function clampOutsidePortalExclusion(x, y) {
  if (gameState.currentMode !== 'game') return { x, y };

  const exclusionR = getPortalExclusionRadius();
  const dx = x - portal.x;
  const dy = y - portal.y;
  const dist = Math.hypot(dx, dy);

  if (dist >= exclusionR) return { x, y };
  if (dist < 1e-6) return { x: portal.x + exclusionR, y: portal.y };

  const scale = exclusionR / dist;
  return { x: portal.x + dx * scale, y: portal.y + dy * scale };
}

/**
 * Reset canvas and start the current level in game mode.
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
function startGameLevel(canvasWidth, canvasHeight) {
  const level = getCurrentLevel();

  clearParticles();
  clearAnchors();
  portalRipples.length = 0;

  gameState.score = 0;
  gameState.totalSpawned = 0;
  gameState.elapsedTime = 0;
  gameState.targetPercentage = level.targetPercentage;
  gameState.levelState = 'setup';

  layoutGameObjects(canvasWidth, canvasHeight);

  emitterConfig.emitterStyle = 'stream';
  emitterConfig.spawnRate = level.spawnRate;
  emitterConfig.lifespan = level.lifespan;
  spawnAccumulator = 0;

  hideGameModals();
  updateGameOverlay();
}

/**
 * Begin spawning after the player has placed anchors during setup.
 */
function beginGameLevel() {
  if (gameState.currentMode !== 'game' || gameState.levelState !== 'setup') return;

  gameState.levelState = 'playing';
  gameState.elapsedTime = 0;
  spawnAccumulator = 0;
  updateGameOverlay();
}

/**
 * @param {PlayMode} mode
 */
function setPlayMode(mode) {
  gameState.currentMode = mode;

  const gameOverlay = document.getElementById('gameOverlay');
  const gameHint = document.getElementById('gameModeHint');
  const isGame = mode === 'game';

  if (gameOverlay) gameOverlay.hidden = !isGame;
  if (gameHint) gameHint.hidden = !isGame;
  updateSandboxOnlyControls(isGame);

  if (isGame) {
    startGameLevel(canvasWidth, canvasHeight);
  } else {
    gameState.levelState = 'playing';
    hideGameModals();
    portalRipples.length = 0;
  }
}

function hideGameModals() {
  const victoryModal = document.getElementById('victoryModal');
  const defeatModal = document.getElementById('defeatModal');
  if (victoryModal) victoryModal.hidden = true;
  if (defeatModal) defeatModal.hidden = true;
}

/**
 * Show/hide sidebar controls that only apply in sandbox mode.
 * @param {boolean} isGame
 */
function updateSandboxOnlyControls(isGame) {
  const sandboxOnly = document.querySelectorAll('.sandbox-only');
  sandboxOnly.forEach((el) => {
    /** @type {HTMLElement} */ (el).hidden = isGame;
  });
}

/**
 * @param {LevelState} state
 */
function setLevelState(state) {
  gameState.levelState = state;
}

/**
 * @param {Particle} particle
 */
function absorbParticleIntoPortal(particle) {
  portalRipples.push({
    x: particle.position.x,
    y: particle.position.y,
    age: 0,
    maxAge: 0.55,
    color: particle.color,
    maxRadius: particle.radius * 5,
  });

  gameState.score += 1;
}

/**
 * @param {number} dt
 */
function updatePortalRipples(dt) {
  for (let i = portalRipples.length - 1; i >= 0; i--) {
    portalRipples[i].age += dt;
    if (portalRipples[i].age >= portalRipples[i].maxAge) {
      portalRipples.splice(i, 1);
    }
  }
}

/**
 * @param {Particle} particle
 * @returns {boolean}
 */
function isParticleInPortal(particle) {
  const dx = particle.position.x - portal.x;
  const dy = particle.position.y - portal.y;
  return Math.hypot(dx, dy) <= portal.radius + particle.radius * 0.5;
}

function checkGameEndConditions() {
  if (gameState.levelState !== 'playing') return;

  const level = getCurrentLevel();
  const successPct = getSuccessPercentage();

  if (gameState.totalSpawned > 0 && successPct >= level.targetPercentage) {
    setLevelState('victory');
    showVictoryModal();
    return;
  }

  const timeUp = gameState.elapsedTime >= level.timeLimit;
  const allSpawned = gameState.totalSpawned >= level.maxParticles;
  const fieldClear = particles.length === 0;

  if (timeUp || (allSpawned && fieldClear)) {
    if (successPct < level.targetPercentage) {
      setLevelState('defeat');
      showDefeatModal();
    }
  }
}

function showVictoryModal() {
  const level = getCurrentLevel();
  const pct = Math.round(getSuccessPercentage() * 100);

  const victoryModal = document.getElementById('victoryModal');
  const victoryMessage = document.getElementById('victoryMessage');
  const victoryScore = document.getElementById('victoryScore');
  const nextLevelBtn = document.getElementById('nextLevelBtn');

  if (victoryMessage) {
    victoryMessage.textContent = `Level "${level.name}" complete — you steered particles into the portal from mid-field.`;
  }
  if (victoryScore) {
    victoryScore.textContent = `${pct}% saved (${gameState.score} / ${gameState.totalSpawned})`;
  }
  if (nextLevelBtn) {
    nextLevelBtn.hidden = gameState.levelIndex >= LEVELS.length - 1;
  }
  if (victoryModal) victoryModal.hidden = false;
}

function showDefeatModal() {
  const pct = Math.round(getSuccessPercentage() * 100);
  const level = getCurrentLevel();

  const defeatModal = document.getElementById('defeatModal');
  const defeatMessage = document.getElementById('defeatMessage');
  const defeatScore = document.getElementById('defeatScore');

  if (defeatMessage) {
    defeatMessage.textContent = `Reach ${Math.round(level.targetPercentage * 100)}% to win. Place anchors in mid-field — they cannot go on the portal.`;
  }
  if (defeatScore) {
    defeatScore.textContent = `${pct}% saved (${gameState.score} / ${gameState.totalSpawned})`;
  }
  if (defeatModal) defeatModal.hidden = false;
}

function updateGameOverlay() {
  if (gameState.currentMode !== 'game') return;

  const level = getCurrentLevel();
  const isSetup = gameState.levelState === 'setup';
  const successPct = getSuccessPercentage();
  const pctDisplay = Math.round(successPct * 100);
  const targetDisplay = Math.round(level.targetPercentage * 100);
  const timeLeft = Math.max(0, level.timeLimit - gameState.elapsedTime);
  const particlesLeft = Math.max(0, level.maxParticles - gameState.totalSpawned);

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText('gameLevelLabel', `Level ${gameState.levelIndex + 1} — ${level.name}`);
  setText(
    'gameObjective',
    isSetup
      ? 'Place anchors on the canvas, then start the level'
      : `Save ${targetDisplay}% of particles in the portal`,
  );
  setText('gameProgressLabel', isSetup ? '—' : `${pctDisplay}%`);
  setText('gameSavedCount', String(gameState.score));
  setText('gameSpawnedCount', String(gameState.totalSpawned));
  setText('gameTimeRemaining', isSetup ? '—' : `${Math.ceil(timeLeft)}s`);
  setText('gameParticlesRemaining', isSetup ? String(level.maxParticles) : String(particlesLeft));
  setText('gameAnchorCount', `${anchors.length}/${level.maxAnchors}`);

  const setupPanel = document.getElementById('gameSetupPanel');
  const progressPanel = document.getElementById('gameProgressPanel');
  if (setupPanel) setupPanel.hidden = !isSetup;
  if (progressPanel) progressPanel.hidden = isSetup;

  const fill = document.getElementById('gameProgressFill');
  const target = document.getElementById('gameProgressTarget');
  if (fill) fill.style.width = isSetup ? '0%' : `${Math.min(100, successPct * 100)}%`;
  if (target) target.style.left = `${level.targetPercentage * 100}%`;
}

/**
 * Game-mode spawn from the left emitter, streaming toward the portal.
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @returns {{ x: number, y: number, vx: number, vy: number }}
 */
function computeGameSpawnParams(canvasWidth, canvasHeight) {
  const level = getCurrentLevel();
  const speed = randomRange(level.speedMin, level.speedMax);
  const spreadY = canvasHeight * level.spawnSpread;
  const y = gameEmitter.y + randomRange(-spreadY, spreadY);

  const dx = portal.x - gameEmitter.x;
  const dy = portal.y - y;
  const aimAngle = Math.atan2(dy, dx) + randomRange(-level.aimSpread, level.aimSpread);

  return {
    x: gameEmitter.x,
    y,
    vx: Math.cos(aimAngle) * speed,
    vy: Math.sin(aimAngle) * speed,
  };
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
 * @param {boolean} [fromGameMode]
 */
function spawnParticle(canvasWidth, canvasHeight, fromGameMode = false) {
  if (particles.length >= physicsConfig.maxParticles) return;

  const { x, y, vx, vy } = fromGameMode
    ? computeGameSpawnParams(canvasWidth, canvasHeight)
    : computeSpawnParams(emitterConfig.emitterStyle, canvasWidth, canvasHeight);

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

  if (fromGameMode) {
    gameState.totalSpawned += 1;
  }
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
 * @returns {boolean} true if anchor was placed
 */
function addOrbitalAnchor(x, y) {
  if (gameState.currentMode === 'game') {
    const level = getCurrentLevel();
    if (anchors.length >= level.maxAnchors) return false;
    if (isInsidePortalExclusionZone(x, y)) return false;
  }

  anchors.push({
    position: { x, y },
    mass: anchorConfig.mass,
    radius: anchorConfig.radius,
    mode: 'attractive',
    baseMass: anchorConfig.mass,
    baseRadius: anchorConfig.radius,
  });
  selectedAnchorIndex = anchors.length - 1;

  if (gameState.currentMode === 'game') {
    updateGameOverlay();
  }

  return true;
}

function clearAnchors() {
  anchors.length = 0;
  selectedAnchorIndex = -1;

  if (gameState.currentMode === 'game') {
    updateGameOverlay();
  }
}

/**
 * Integrate particle motion for one timestep (sandbox mode).
 * @param {number} dt - delta time in seconds
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
function updateSandboxPhysics(dt, canvasWidth, canvasHeight) {
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
 * Game mode physics — fixed emitter, portal absorption, win/lose tracking.
 * @param {number} dt
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
function updateGamePhysics(dt, canvasWidth, canvasHeight) {
  updatePortalRipples(dt);

  if (gameState.levelState !== 'playing') return;

  gameState.elapsedTime += dt;

  const level = getCurrentLevel();
  spawnAccumulator += dt;
  const spawnInterval = 1 / level.spawnRate;

  while (
    spawnAccumulator >= spawnInterval &&
    gameState.totalSpawned < level.maxParticles
  ) {
    spawnParticle(canvasWidth, canvasHeight, true);
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

    if (isParticleInPortal(p)) {
      absorbParticleIntoPortal(p);
      particles.splice(i, 1);
      continue;
    }

    const outOfBounds =
      p.position.x < -p.radius ||
      p.position.x > canvasWidth + p.radius ||
      p.position.y < -p.radius ||
      p.position.y > canvasHeight + p.radius;

    if (p.age >= p.lifespan || outOfBounds) {
      particles.splice(i, 1);
    }
  }

  checkGameEndConditions();
  updateGameOverlay();
}

/**
 * @param {number} dt
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
function updatePhysics(dt, canvasWidth, canvasHeight) {
  if (gameState.currentMode === 'game') {
    updateGamePhysics(dt, canvasWidth, canvasHeight);
  } else {
    updateSandboxPhysics(dt, canvasWidth, canvasHeight);
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

  if (gameState.currentMode === 'game') {
    portal.x *= scaleX;
    portal.y *= scaleY;
    portal.radius *= (scaleX + scaleY) * 0.5;
    gameEmitter.x *= scaleX;
    gameEmitter.y *= scaleY;

    for (const ripple of portalRipples) {
      ripple.x *= scaleX;
      ripple.y *= scaleY;
      ripple.maxRadius *= (scaleX + scaleY) * 0.5;
    }
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
 * Pulsing portal rings on the right — absorption target in game mode.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 */
function drawPortal(ctx, time) {
  const { x, y, radius } = portal;
  const ringCount = 4;

  ctx.save();

  const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius * 1.4);
  gradient.addColorStop(0, 'rgba(110, 231, 255, 0.35)');
  gradient.addColorStop(0.6, 'rgba(129, 140, 248, 0.12)');
  gradient.addColorStop(1, 'rgba(129, 140, 248, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 2;
  for (let i = 0; i < ringCount; i++) {
    const phase = (time * 0.5 + i * 0.2) % 1;
    const ringRadius = radius * (0.55 + phase * 0.55);
    const alpha = 0.5 * (1 - phase);
    ctx.strokeStyle = `rgba(110, 231, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(110, 231, 255, 0.2)';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2);
  ctx.fill();

  const exclusionR = getPortalExclusionRadius();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, exclusionR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

/**
 * Left-side emitter marker in game mode.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} time
 */
function drawGameEmitter(ctx, time) {
  const { x, y } = gameEmitter;
  const pulse = 0.5 + 0.5 * Math.sin(time * 4);

  ctx.save();

  ctx.fillStyle = `rgba(244, 114, 182, ${0.15 + pulse * 0.1})`;
  ctx.beginPath();
  ctx.arc(x, y, 18 + pulse * 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(244, 114, 182, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 10, y);
  ctx.lineTo(x + 14, y);
  ctx.stroke();

  ctx.fillStyle = '#f472b6';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Expanding ripple when a particle dissolves into the portal.
 * @param {CanvasRenderingContext2D} ctx
 * @param {PortalRipple} ripple
 */
function drawPortalRipple(ctx, ripple) {
  const t = ripple.age / ripple.maxAge;
  const radius = ripple.maxRadius * (0.4 + t * 1.2);
  const alpha = (1 - t) * 0.75;

  ctx.save();
  ctx.strokeStyle = ripple.color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2 * (1 - t * 0.5);
  ctx.beginPath();
  ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(110, 231, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ripple.x, ripple.y, radius * 0.65, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
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

  if (gameState.currentMode === 'game') {
    drawGameEmitter(ctx, simTime);
    drawPortal(ctx, simTime);
  }

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

  for (const ripple of portalRipples) {
    drawPortalRipple(ctx, ripple);
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

  if (gameState.currentMode === 'game') {
    layoutGameObjects(canvasWidth, canvasHeight);
  }
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
  initGameModeUI();
  updateSandboxOnlyControls(gameState.currentMode === 'game');

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

// ── Game mode UI ──────────────────────────────────────────────────────────────

function initGameModeUI() {
  const modeRadios = document.querySelectorAll('input[name="playMode"]');
  modeRadios.forEach((radio) => {
    const onModeSelect = () => {
      if (/** @type {HTMLInputElement} */ (radio).checked) {
        setPlayMode(/** @type {PlayMode} */ (/** @type {HTMLInputElement} */ (radio).value));
      }
    };
    radio.addEventListener('change', onModeSelect);
    radio.addEventListener('input', onModeSelect);
  });

  document.getElementById('nextLevelBtn')?.addEventListener('click', () => {
    if (gameState.levelIndex < LEVELS.length - 1) {
      gameState.levelIndex += 1;
      startGameLevel(canvasWidth, canvasHeight);
    }
  });

  document.getElementById('retryLevelBtn')?.addEventListener('click', () => {
    startGameLevel(canvasWidth, canvasHeight);
  });

  document.getElementById('retryDefeatBtn')?.addEventListener('click', () => {
    startGameLevel(canvasWidth, canvasHeight);
  });

  document.getElementById('startLevelBtn')?.addEventListener('click', () => {
    beginGameLevel();
  });

  const switchToSandbox = () => {
    const sandboxRadio = /** @type {HTMLInputElement | null} */ (
      document.querySelector('input[name="playMode"][value="sandbox"]')
    );
    if (sandboxRadio) {
      sandboxRadio.checked = true;
      setPlayMode('sandbox');
    }
  };

  document.getElementById('sandboxFromVictoryBtn')?.addEventListener('click', switchToSandbox);
  document.getElementById('sandboxFromDefeatBtn')?.addEventListener('click', switchToSandbox);
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
        const clamped = clampOutsidePortalExclusion(
          pos.x + pointerState.dragOffset.x,
          pos.y + pointerState.dragOffset.y,
        );
        anchor.position.x = clamped.x;
        anchor.position.y = clamped.y;
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
