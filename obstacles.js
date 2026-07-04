/** @typedef {{ x: number, y: number }} Vec2 */

/** @typedef {'hostile_devourer' | 'solid_asteroid' | 'wind_field'} ObstacleType */

/**
 * Declarative obstacle placement — normalized 0–1 coords; radii as fraction of min(canvasW, canvasH).
 * @typedef {{
 *   type: 'hostile_devourer',
 *   x: number,
 *   y: number,
 *   eventHorizonRadius: number,
 *   coreRadius?: number,
 * }} DevourerObstacleConfig
 */

/** @typedef {{
 *   type: 'solid_asteroid',
 *   x: number,
 *   y: number,
 *   radius: number,
 *   restitution?: number,
 * }} AsteroidObstacleConfig
 */

/** @typedef {{
 *   type: 'wind_field',
 *   x: number,
 *   y: number,
 *   width: number,
 *   height: number,
 *   forceX: number,
 *   forceY: number,
 * }} WindFieldObstacleConfig
 */

/** @typedef {DevourerObstacleConfig | AsteroidObstacleConfig | WindFieldObstacleConfig} ObstacleConfig */

/** @typedef {{ position: Vec2, velocity: Vec2, radius: number }} ParticleLike */

/**
 * Base obstacle — physics hooks + canvas draw.
 * Subclasses override the methods relevant to their type.
 */
export class Obstacle {
  /** @param {ObstacleType} type */
  constructor(type) {
    this.type = type;
  }

  /**
   * Constant draft force while a particle is inside the field (wind fields only).
   * @param {ParticleLike} _particle
   * @returns {Vec2}
   */
  getWindAcceleration(_particle) {
    return { x: 0, y: 0 };
  }

  /**
   * Circle–circle elastic bounce (solid asteroids only).
   * @param {ParticleLike} _particle
   */
  resolveCollision(_particle) {}

  /**
   * @param {ParticleLike} _particle
   * @returns {boolean} true when the particle should be removed (devourers)
   */
  consumesParticle(_particle) {
    return false;
  }

  /**
   * @param {CanvasRenderingContext2D} _ctx
   * @param {number} _time
   */
  draw(_ctx, _time) {}

  /**
   * Scale positions and sizes when the canvas resizes.
   * @param {number} scaleX
   * @param {number} scaleY
   * @param {number} avgScale
   */
  scale(_scaleX, _scaleY, _avgScale) {}
}

/**
 * hostile_devourer — pulsing singularity; particles crossing the event horizon vanish.
 */
export class HostileDevourer extends Obstacle {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} eventHorizonRadius
   * @param {number} [coreRadius]
   */
  constructor(x, y, eventHorizonRadius, coreRadius) {
    super('hostile_devourer');
    this.position = { x, y };
    this.eventHorizonRadius = eventHorizonRadius;
    this.coreRadius = coreRadius ?? eventHorizonRadius * 0.35;
  }

  /** @param {ParticleLike} particle */
  consumesParticle(particle) {
    const dx = particle.position.x - this.position.x;
    const dy = particle.position.y - this.position.y;
    const dist = Math.hypot(dx, dy);
    return dist <= this.eventHorizonRadius + particle.radius * 0.25;
  }

  /** @param {CanvasRenderingContext2D} ctx @param {number} time */
  draw(ctx, time) {
    const { x, y } = this.position;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
    const horizonPulse = this.eventHorizonRadius * (1 + pulse * 0.06);

    ctx.save();

    const halo = ctx.createRadialGradient(x, y, this.coreRadius, x, y, horizonPulse * 1.35);
    halo.addColorStop(0, `rgba(239, 68, 68, ${0.35 + pulse * 0.15})`);
    halo.addColorStop(0.55, 'rgba(127, 29, 29, 0.18)');
    halo.addColorStop(1, 'rgba(127, 29, 29, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, horizonPulse * 1.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(248, 113, 113, ${0.45 + pulse * 0.35})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.arc(x, y, horizonPulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const coreR = this.coreRadius * (0.85 + pulse * 0.2);
    const coreGrad = ctx.createRadialGradient(x, y, 0, x, y, coreR);
    coreGrad.addColorStop(0, '#fecaca');
    coreGrad.addColorStop(0.45, '#ef4444');
    coreGrad.addColorStop(1, '#7f1d1d');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(x, y, coreR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(254, 202, 202, ${0.5 + pulse * 0.3})`;
    ctx.beginPath();
    ctx.arc(x - coreR * 0.22, y - coreR * 0.22, coreR * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** @param {number} scaleX @param {number} scaleY @param {number} avgScale */
  scale(scaleX, scaleY, avgScale) {
    this.position.x *= scaleX;
    this.position.y *= scaleY;
    this.eventHorizonRadius *= avgScale;
    this.coreRadius *= avgScale;
  }
}

/**
 * solid_asteroid — elastic circle boundary; restitution e controls bounce energy retention.
 * v' = v − (1 + e)(v · n̂) n̂
 */
export class SolidAsteroid extends Obstacle {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {number} [restitution]
   */
  constructor(x, y, radius, restitution = 0.82) {
    super('solid_asteroid');
    this.position = { x, y };
    this.radius = radius;
    this.restitution = restitution;
  }

  /** @param {ParticleLike} particle */
  resolveCollision(particle) {
    const dx = particle.position.x - this.position.x;
    const dy = particle.position.y - this.position.y;
    const dist = Math.hypot(dx, dy);
    const minDist = this.radius + particle.radius;

    if (dist >= minDist || dist < 1e-6) return;

    const nx = dx / dist;
    const ny = dy / dist;

    particle.position.x = this.position.x + nx * minDist;
    particle.position.y = this.position.y + ny * minDist;

    const vn = particle.velocity.x * nx + particle.velocity.y * ny;
    if (vn < 0) {
      const bounce = (1 + this.restitution) * vn;
      particle.velocity.x -= bounce * nx;
      particle.velocity.y -= bounce * ny;
    }
  }

  /** @param {CanvasRenderingContext2D} ctx @param {number} time */
  draw(ctx, time) {
    const { x, y } = this.position;
    const r = this.radius;
    const spin = time * 0.4;

    ctx.save();

    const bodyGrad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    bodyGrad.addColorStop(0, '#94a3b8');
    bodyGrad.addColorStop(0.55, '#475569');
    bodyGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const a0 = spin + (i / 5) * Math.PI * 2;
      const a1 = a0 + 0.6;
      ctx.beginPath();
      ctx.arc(x, y, r * (0.55 + (i % 3) * 0.12), a0, a1);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(203, 213, 225, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  /** @param {number} scaleX @param {number} scaleY @param {number} avgScale */
  scale(scaleX, scaleY, avgScale) {
    this.position.x *= scaleX;
    this.position.y *= scaleY;
    this.radius *= avgScale;
  }
}

/**
 * wind_field — constant directional force F/m inside an axis-aligned rectangle.
 */
export class WindField extends Obstacle {
  /**
   * @param {number} x top-left
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {number} forceX
   * @param {number} forceY
   */
  constructor(x, y, width, height, forceX, forceY) {
    super('wind_field');
    this.bounds = { x, y, width, height };
    this.force = { x: forceX, y: forceY };
  }

  /** @param {ParticleLike} particle */
  getWindAcceleration(particle) {
    const { x, y, width, height } = this.bounds;
    const px = particle.position.x;
    const py = particle.position.y;

    if (px >= x && px <= x + width && py >= y && py <= y + height) {
      return { x: this.force.x, y: this.force.y };
    }
    return { x: 0, y: 0 };
  }

  /** @param {CanvasRenderingContext2D} ctx @param {number} time */
  draw(ctx, time) {
    const { x, y, width, height } = this.bounds;
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.5);
    const forceMag = Math.hypot(this.force.x, this.force.y);

    ctx.save();

    ctx.fillStyle = `rgba(56, 189, 248, ${0.06 + pulse * 0.04})`;
    ctx.fillRect(x, y, width, height);

    ctx.strokeStyle = `rgba(56, 189, 248, ${0.35 + pulse * 0.15})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.setLineDash([]);

    if (forceMag > 1e-3) {
      const dirX = this.force.x / forceMag;
      const dirY = this.force.y / forceMag;
      const spacing = 28;
      const cols = Math.max(1, Math.floor(width / spacing));
      const rows = Math.max(1, Math.floor(height / spacing));
      const offset = (time * 40) % spacing;

      ctx.strokeStyle = `rgba(125, 211, 252, ${0.35 + pulse * 0.2})`;
      ctx.lineWidth = 1.2;

      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const ax = x + col * spacing + offset * dirX;
          const ay = y + row * spacing + offset * dirY;
          if (ax < x || ax > x + width || ay < y || ay > y + height) continue;

          const tipX = ax + dirX * 10;
          const tipY = ay + dirY * 10;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  /** @param {number} scaleX @param {number} scaleY @param {number} _avgScale */
  scale(scaleX, scaleY, _avgScale) {
    this.bounds.x *= scaleX;
    this.bounds.y *= scaleY;
    this.bounds.width *= scaleX;
    this.bounds.height *= scaleY;
  }
}

/**
 * Instantiate runtime obstacles from declarative level configs.
 * @param {ObstacleConfig[]} configs
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @returns {Obstacle[]}
 */
export function createObstaclesFromConfig(configs, canvasWidth, canvasHeight) {
  const sizeRef = Math.min(canvasWidth, canvasHeight);
  /** @type {Obstacle[]} */
  const obstacles = [];

  for (const config of configs) {
    switch (config.type) {
      case 'hostile_devourer':
        obstacles.push(
          new HostileDevourer(
            config.x * canvasWidth,
            config.y * canvasHeight,
            config.eventHorizonRadius * sizeRef,
            config.coreRadius != null ? config.coreRadius * sizeRef : undefined,
          ),
        );
        break;
      case 'solid_asteroid':
        obstacles.push(
          new SolidAsteroid(
            config.x * canvasWidth,
            config.y * canvasHeight,
            config.radius * sizeRef,
            config.restitution,
          ),
        );
        break;
      case 'wind_field':
        obstacles.push(
          new WindField(
            config.x * canvasWidth,
            config.y * canvasHeight,
            config.width * canvasWidth,
            config.height * canvasHeight,
            config.forceX,
            config.forceY,
          ),
        );
        break;
      default:
        break;
    }
  }

  return obstacles;
}

/**
 * Sum wind-field accelerations for a particle (a = F/m).
 * @param {ParticleLike} particle
 * @param {Obstacle[]} obstacles
 * @param {number} particleMass
 * @returns {Vec2}
 */
export function computeObstacleAcceleration(particle, obstacles, particleMass = 1) {
  let ax = 0;
  let ay = 0;

  for (const obstacle of obstacles) {
    const wind = obstacle.getWindAcceleration(particle);
    ax += wind.x / particleMass;
    ay += wind.y / particleMass;
  }

  return { x: ax, y: ay };
}

/**
 * Asteroid bounces + devourer consumption after position integration.
 * @param {ParticleLike} particle
 * @param {Obstacle[]} obstacles
 * @returns {boolean} true if the particle was consumed by a devourer
 */
export function applyObstacleCollisionsAndConsumption(particle, obstacles) {
  for (const obstacle of obstacles) {
    obstacle.resolveCollision(particle);
  }

  for (const obstacle of obstacles) {
    if (obstacle.consumesParticle(particle)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Obstacle[]} obstacles
 * @param {number} time
 */
export function drawObstacles(ctx, obstacles, time) {
  for (const obstacle of obstacles) {
    obstacle.draw(ctx, time);
  }
}
