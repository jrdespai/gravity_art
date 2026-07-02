// ── Pixel Art Sprite Designer ─────────────────────────────────────────────────
// 16×16 grid editor that compiles drawings into a reusable off-screen canvas
// for particle rendering via ctx.drawImage().

export const GRID_SIZE = 16;
export const COMPILED_SIZE = 32;

/** Kid-friendly palette — null means eraser (transparent) */
export const SPRITE_PALETTE = [
  { id: 'red', label: 'Red', color: '#ef4444' },
  { id: 'orange', label: 'Orange', color: '#f97316' },
  { id: 'yellow', label: 'Yellow', color: '#eab308' },
  { id: 'green', label: 'Green', color: '#22c55e' },
  { id: 'blue', label: 'Blue', color: '#3b82f6' },
  { id: 'cyan', label: 'Cyan', color: '#06b6d4' },
  { id: 'purple', label: 'Purple', color: '#a855f7' },
  { id: 'white', label: 'White', color: '#ffffff' },
  { id: 'eraser', label: 'Eraser', color: null },
];

/**
 * @typedef {Object} SpriteDesignerState
 * @property {((canvas: HTMLCanvasElement) => void) | null} onApply
 */

/** @type {SpriteDesignerState} */
const state = {
  onApply: null,
};

/** @type {(string | null)[][]} Each cell holds a hex color or null (transparent) */
let grid = createEmptyGrid();

/** Currently selected palette color (null = eraser) */
let activeColor = SPRITE_PALETTE[0].color;

/** Off-screen canvas holding the compiled sprite at COMPILED_SIZE × COMPILED_SIZE */
let compiledCanvas = /** @type {HTMLCanvasElement | null} */ (null);
let compiledCtx = /** @type {CanvasRenderingContext2D | null} */ (null);

/** @type {HTMLCanvasElement | null} */
let gridCanvas = null;

/** @type {CanvasRenderingContext2D | null} */
let gridCtx = null;

/** Pixel size of each grid cell on the editor canvas */
const CELL_PX = 14;

let isPainting = false;

/**
 * @returns {(string | null)[][]}
 */
function createEmptyGrid() {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => null),
  );
}

/**
 * @param {(string | null)[][]} source
 * @returns {(string | null)[][]}
 */
function cloneGrid(source) {
  return source.map((row) => [...row]);
}

/**
 * Render the 16×16 editor grid to the visible canvas.
 */
function renderGrid() {
  if (!gridCtx || !gridCanvas) return;

  const size = GRID_SIZE * CELL_PX;
  gridCtx.clearRect(0, 0, size, size);

  // Checkerboard background for transparent cells
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const x = col * CELL_PX;
      const y = row * CELL_PX;
      const isLight = (row + col) % 2 === 0;
      gridCtx.fillStyle = isLight ? '#1e2430' : '#161a24';
      gridCtx.fillRect(x, y, CELL_PX, CELL_PX);
    }
  }

  // Painted pixels
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const color = grid[row][col];
      if (!color) continue;
      gridCtx.fillStyle = color;
      gridCtx.fillRect(col * CELL_PX, row * CELL_PX, CELL_PX, CELL_PX);
    }
  }

  // Grid lines
  gridCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  gridCtx.lineWidth = 1;
  for (let i = 0; i <= GRID_SIZE; i++) {
    gridCtx.beginPath();
    gridCtx.moveTo(i * CELL_PX + 0.5, 0);
    gridCtx.lineTo(i * CELL_PX + 0.5, size);
    gridCtx.stroke();
    gridCtx.beginPath();
    gridCtx.moveTo(0, i * CELL_PX + 0.5);
    gridCtx.lineTo(size, i * CELL_PX + 0.5);
    gridCtx.stroke();
  }
}

/**
 * Map pointer coordinates to grid cell indices.
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ col: number, row: number } | null}
 */
function pointerToCell(clientX, clientY) {
  if (!gridCanvas) return null;
  const rect = gridCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const col = Math.floor(x / CELL_PX);
  const row = Math.floor(y / CELL_PX);
  if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) return null;
  return { col, row };
}

/**
 * Paint a single cell with the active color.
 * @param {number} col
 * @param {number} row
 */
function paintCell(col, row) {
  grid[row][col] = activeColor;
  renderGrid();
}

/**
 * Compile the current grid into the off-screen canvas at COMPILED_SIZE.
 * Uses nearest-neighbor scaling so pixel art stays crisp.
 * @returns {HTMLCanvasElement}
 */
export function compileSprite() {
  if (!compiledCanvas || !compiledCtx) {
    compiledCanvas = document.createElement('canvas');
    compiledCanvas.width = COMPILED_SIZE;
    compiledCanvas.height = COMPILED_SIZE;
    compiledCtx = compiledCanvas.getContext('2d');
  }

  const ctx = compiledCtx;
  if (!ctx) return compiledCanvas;

  ctx.clearRect(0, 0, COMPILED_SIZE, COMPILED_SIZE);
  ctx.imageSmoothingEnabled = false;

  const pixelSize = COMPILED_SIZE / GRID_SIZE;

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const color = grid[row][col];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(col * pixelSize, row * pixelSize, pixelSize, pixelSize);
    }
  }

  return compiledCanvas;
}

/** @returns {HTMLCanvasElement | null} */
export function getCompiledSpriteCanvas() {
  return compiledCanvas;
}

function clearGrid() {
  grid = createEmptyGrid();
  renderGrid();
}

function fillGrid() {
  if (!activeColor) return;
  grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => activeColor),
  );
  renderGrid();
}

function applyToParticles() {
  const canvas = compileSprite();
  if (state.onApply) state.onApply(canvas);
}

/**
 * @param {Object} options
 * @param {(canvas: HTMLCanvasElement) => void} options.onApply
 */
export function initSpriteDesigner({ onApply }) {
  state.onApply = onApply;

  gridCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('spriteGrid'));
  gridCtx = gridCanvas.getContext('2d');

  const displaySize = GRID_SIZE * CELL_PX;
  gridCanvas.width = displaySize;
  gridCanvas.height = displaySize;

  // Build palette buttons
  const paletteEl = document.getElementById('spritePalette');
  if (paletteEl) {
    paletteEl.innerHTML = '';
    for (const entry of SPRITE_PALETTE) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sprite-palette__swatch';
      btn.title = entry.label;
      btn.setAttribute('aria-label', entry.label);
      btn.dataset.color = entry.color ?? 'eraser';

      if (entry.color) {
        btn.style.background = entry.color;
      } else {
        btn.classList.add('sprite-palette__swatch--eraser');
      }

      if (entry.color === activeColor) {
        btn.classList.add('sprite-palette__swatch--active');
      }

      btn.addEventListener('click', () => {
        activeColor = entry.color;
        paletteEl.querySelectorAll('.sprite-palette__swatch').forEach((el) => {
          el.classList.toggle(
            'sprite-palette__swatch--active',
            /** @type {HTMLElement} */ (el).dataset.color === (entry.color ?? 'eraser'),
          );
        });
      });

      paletteEl.appendChild(btn);
    }
  }

  document.getElementById('spriteClearBtn')?.addEventListener('click', clearGrid);
  document.getElementById('spriteFillBtn')?.addEventListener('click', fillGrid);
  document.getElementById('spriteApplyBtn')?.addEventListener('click', applyToParticles);

  const startPaint = (e) => {
    isPainting = true;
    const cell = pointerToCell(e.clientX, e.clientY);
    if (cell) paintCell(cell.col, cell.row);
  };

  const movePaint = (e) => {
    if (!isPainting) return;
    const cell = pointerToCell(e.clientX, e.clientY);
    if (cell) paintCell(cell.col, cell.row);
  };

  const stopPaint = () => {
    isPainting = false;
  };

  gridCanvas.addEventListener('mousedown', startPaint);
  gridCanvas.addEventListener('mousemove', movePaint);
  window.addEventListener('mouseup', stopPaint);

  gridCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (touch) startPaint(touch);
  }, { passive: false });

  gridCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (touch) movePaint(touch);
  }, { passive: false });

  window.addEventListener('touchend', stopPaint);

  renderGrid();
}

/**
 * Export grid state for persistence (future use).
 * @returns {(string | null)[][]}
 */
export function exportGrid() {
  return cloneGrid(grid);
}
