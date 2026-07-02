// ── Asset Injector ────────────────────────────────────────────────────────────
// Swap particle visuals by registering draw functions or loading sprite images.
// New assets: add a renderer here, expose it via ASSET_TYPES, wire the sidebar.

/** @typedef {'circle' | 'square' | 'star' | 'pixel' | 'sprite'} AssetType */

/** @typedef {(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) => void} AssetDrawFn */

/** @typedef {HTMLImageElement | HTMLCanvasElement} SpriteSource */

/** @typedef {{ type: AssetType, image: SpriteSource | null, draw: AssetDrawFn }} AssetRenderer */

export const ASSET_TYPES = /** @type {const} */ ({
  circle: 'circle',
  square: 'square',
  star: 'star',
  pixel: 'pixel',
  sprite: 'sprite',
});

/** @type {Record<Exclude<AssetType, 'sprite'>, AssetDrawFn>} */
const shapeRenderers = {
  circle(ctx, x, y, radius, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  },

  square(ctx, x, y, radius, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const size = radius * 1.6;
    ctx.fillRect(x - size * 0.5, y - size * 0.5, size, size);
  },

  star(ctx, x, y, radius, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    const spikes = 5;
    const outer = radius * 1.4;
    const inner = radius * 0.55;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const angle = (i * Math.PI) / spikes - Math.PI / 2;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  },

  pixel(ctx, x, y, radius, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const size = Math.max(2, Math.round(radius));
    const px = Math.round(x - size * 0.5);
    const py = Math.round(y - size * 0.5);
    ctx.fillRect(px, py, size, size);
  },
};

/**
 * Draw a loaded sprite image centered at (x, y).
 * Falls back to a circle if no image is loaded yet.
 * @type {AssetDrawFn}
 */
function spriteRenderer(ctx, x, y, radius, color, alpha) {
  const renderer = /** @type {AssetRenderer} */ (spriteRenderer._active);
  const source = renderer?.image;
  if (!source || !isSpriteSourceReady(source)) {
    shapeRenderers.circle(ctx, x, y, radius, color, alpha);
    return;
  }

  const size = radius * 3;
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, x - size * 0.5, y - size * 0.5, size, size);
  ctx.imageSmoothingEnabled = true;
}

/**
 * @param {SpriteSource} source
 * @returns {boolean}
 */
function isSpriteSourceReady(source) {
  if (source instanceof HTMLCanvasElement) {
    return source.width > 0 && source.height > 0;
  }
  return source.complete && source.naturalWidth > 0;
}

/** @type {AssetDrawFn & { _active?: AssetRenderer }} */
spriteRenderer._active = undefined;

/** @type {Map<AssetType, AssetRenderer>} */
const rendererCache = new Map();

/**
 * @param {AssetType} type
 * @param {SpriteSource | null} [image]
 * @returns {AssetRenderer}
 */
export function getAssetRenderer(type, image = null) {
  const cacheKey =
    type === ASSET_TYPES.sprite && image
      ? image instanceof HTMLCanvasElement
        ? 'sprite:designer'
        : `sprite:${image.src}`
      : type;
  const cached = rendererCache.get(/** @type {AssetType} */ (cacheKey));
  if (cached && (type !== ASSET_TYPES.sprite || cached.image === image)) return cached;

  /** @type {AssetDrawFn} */
  let draw;
  if (type === ASSET_TYPES.sprite) {
    draw = spriteRenderer;
  } else {
    draw = shapeRenderers[type] ?? shapeRenderers.circle;
  }

  /** @type {AssetRenderer} */
  const renderer = { type, image, draw };
  if (type === ASSET_TYPES.sprite) {
    spriteRenderer._active = renderer;
  }

  rendererCache.set(/** @type {AssetType} */ (cacheKey), renderer);
  return renderer;
}

/**
 * Use a compiled canvas from the Sprite Designer as the active sprite source.
 * @param {HTMLCanvasElement} canvas
 * @returns {AssetRenderer}
 */
export function setDesignerSprite(canvas) {
  return getAssetRenderer(ASSET_TYPES.sprite, canvas);
}

/**
 * Load a custom sprite image for the sprite asset type.
 * @param {string} src
 * @returns {Promise<AssetRenderer>}
 */
export function loadSpriteAsset(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(getAssetRenderer(ASSET_TYPES.sprite, img));
    img.onerror = () => reject(new Error(`Failed to load sprite: ${src}`));
    img.src = src;
  });
}

/**
 * Register a custom shape renderer at runtime (e.g. kid-drawn paths).
 * @param {string} id
 * @param {AssetDrawFn} drawFn
 * @returns {AssetRenderer}
 */
export function registerCustomAsset(id, drawFn) {
  /** @type {AssetRenderer} */
  const renderer = { type: ASSET_TYPES.circle, image: null, draw: drawFn };
  rendererCache.set(/** @type {AssetType} */ (id), renderer);
  return renderer;
}
