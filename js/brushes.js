/**
 * Brush registry. A brush knows how to render one segment of a stroke onto a
 * 2D canvas context. New styles can be added by implementing the same
 * interface and registering them in BRUSHES.
 *
 * Brush interface:
 *   drawSegment(ctx, from, to, settings, segIndex)
 *     - from / to:  {x, y} in canvas pixel coordinates
 *     - settings:   {color, size, seed} (the stroke record itself is passed)
 *     - segIndex:   index of this segment within the stroke, so brushes can
 *                   vary along the stroke and replay deterministically
 *   drawDot(ctx, point, settings)
 *     - used for single-point strokes (a tap with no movement)
 *
 * Randomness must come from segRng(seed, segIndex) so that redrawing the
 * stroke list (undo, resize) reproduces the exact same pixels.
 */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segRng(seed, segIndex) {
  return mulberry32((seed ^ Math.imul(segIndex + 1, 0x85ebca6b)) >>> 0);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(rgb, target, t) {
  return rgb.map((c, i) => Math.round(c + (target[i] - c) * t));
}

function css(rgb, a = 1) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

function line(ctx, from, to, style, width) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/** Unit vector along the segment plus its perpendicular. */
function segFrame(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { len, ux: dx / len, uy: dy / len, px: -dy / len, py: dx / len };
}

class BaseBrush {
  drawDot(ctx, point, s) {
    this.drawSegment(ctx, point, { x: point.x + 0.1, y: point.y + 0.1 }, s, 0);
  }
}

class SolidBrush extends BaseBrush {
  drawSegment(ctx, from, to, s) {
    line(ctx, from, to, s.color, s.size);
  }

  drawDot(ctx, point, s) {
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, s.size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Bristle texture: several thin parallel streaks of varying opacity. The
 *  bristle pattern is derived from the stroke seed only, so each bristle
 *  stays continuous along the whole stroke. */
class PaintBrush extends BaseBrush {
  drawSegment(ctx, from, to, s, segIndex) {
    const rng = mulberry32((s.seed ^ 0x9e3779b9) >>> 0);
    const { px, py } = segFrame(from, to);
    const n = Math.max(4, Math.round(s.size / 2.5));
    const wobble = segRng(s.seed, segIndex);
    for (let b = 0; b < n; b++) {
      const off = ((b / (n - 1)) - 0.5) * s.size * 0.95 + (rng() - 0.5) * 2;
      const alpha = 0.25 + rng() * 0.5;
      const w = Math.max(0.6, (s.size / n) * (0.8 + rng() * 0.9));
      const j = (wobble() - 0.5) * 1.2;
      line(
        ctx,
        { x: from.x + px * (off + j), y: from.y + py * (off + j) },
        { x: to.x + px * (off + j), y: to.y + py * (off + j) },
        css(hexToRgb(s.color), alpha),
        w
      );
    }
  }
}

class SprayBrush extends BaseBrush {
  drawSegment(ctx, from, to, s, segIndex) {
    const rng = segRng(s.seed, segIndex);
    const rgb = hexToRgb(s.color);
    const dots = Math.max(8, Math.round(s.size * 2.2));
    for (let d = 0; d < dots; d++) {
      const t = rng();
      const cx = from.x + (to.x - from.x) * t;
      const cy = from.y + (to.y - from.y) * t;
      const ang = rng() * Math.PI * 2;
      const rad = rng() * rng() * s.size; // bias toward the center
      ctx.fillStyle = css(rgb, 0.06 + rng() * 0.2);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, 0.5 + rng() * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Bulging glossy blobs with a darker rim and a wet highlight. */
class GooeyBrush extends BaseBrush {
  drawSegment(ctx, from, to, s, segIndex) {
    const rng = segRng(s.seed, segIndex);
    const rgb = hexToRgb(s.color);
    const rim = mix(rgb, [0, 0, 0], 0.35);
    const gloss = mix(rgb, [255, 255, 255], 0.65);
    const { len, px, py } = segFrame(from, to);
    const steps = Math.max(1, Math.ceil(len / Math.max(2, s.size * 0.3)));
    for (let st = 0; st <= steps; st++) {
      const t = st / steps;
      const cx = from.x + (to.x - from.x) * t;
      const cy = from.y + (to.y - from.y) * t;
      const phase = segIndex * 0.9 + st * 0.55;
      const r = s.size * 0.5 * (0.8 + 0.3 * Math.sin(phase)) * (0.9 + rng() * 0.2);
      ctx.fillStyle = css(rim);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(rgb);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(gloss, 0.7);
      ctx.beginPath();
      ctx.arc(cx - r * 0.3, cy - r * 0.35, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      // occasional satellite droplet flung off the main goo
      if (rng() < 0.05) {
        const side = rng() < 0.5 ? 1 : -1;
        ctx.fillStyle = css(rgb, 0.9);
        ctx.beginPath();
        ctx.arc(cx + px * r * 1.8 * side, cy + py * r * 1.8 * side, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Soft translucent puffs drifting slightly upward. */
class SteamBrush extends BaseBrush {
  drawSegment(ctx, from, to, s, segIndex) {
    const rng = segRng(s.seed, segIndex);
    const light = mix(hexToRgb(s.color), [255, 255, 255], 0.75);
    const { len } = segFrame(from, to);
    const steps = Math.max(1, Math.ceil(len / 6));
    for (let st = 0; st <= steps; st++) {
      const t = st / steps;
      const cx = from.x + (to.x - from.x) * t + (rng() - 0.5) * s.size * 0.8;
      const cy = from.y + (to.y - from.y) * t - rng() * s.size * 0.5;
      const r = s.size * (0.8 + rng() * 0.9);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, css(light, 0.14 + rng() * 0.12));
      g.addColorStop(1, css(light, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Thick rounded paste with a classic white stripe and a sheen. The stripes
 *  overshoot each segment slightly so the next segment's base line (whose
 *  round cap paints past the joint) cannot chop them into dashes. */
class ToothpasteBrush extends BaseBrush {
  drawSegment(ctx, from, to, s) {
    const rgb = hexToRgb(s.color);
    const { ux, uy, px, py } = segFrame(from, to);
    const w = Math.max(4, s.size);
    line(ctx, from, to, css(rgb), w);
    const ov = w * 0.55; // overshoot past both segment ends
    const shade = (off, style, width) =>
      line(
        ctx,
        { x: from.x - ux * ov + px * off, y: from.y - uy * ov + py * off },
        { x: to.x + ux * ov + px * off, y: to.y + uy * ov + py * off },
        style,
        width
      );
    shade(w * 0.28, css(mix(rgb, [0, 0, 0], 0.25)), w * 0.22); // bottom shadow
    shade(-w * 0.15, "rgba(255,255,255,0.9)", w * 0.28);       // white stripe
    shade(-w * 0.34, css(mix(rgb, [255, 255, 255], 0.5), 0.8), w * 0.12); // sheen
  }
}

class NeonBrush extends BaseBrush {
  drawSegment(ctx, from, to, s) {
    const { ux, uy } = segFrame(from, to);
    const ov = s.size * 0.3; // keep the core continuous under the next glow cap
    ctx.save();
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.size * 1.6;
    line(ctx, from, to, s.color, Math.max(2, s.size * 0.5));
    ctx.shadowBlur = s.size * 0.5;
    line(
      ctx,
      { x: from.x - ux * ov, y: from.y - uy * ov },
      { x: to.x + ux * ov, y: to.y + uy * ov },
      "rgba(255,255,255,0.95)",
      Math.max(1, s.size * 0.2)
    );
    ctx.restore();
  }
}

class RainbowBrush extends BaseBrush {
  drawSegment(ctx, from, to, s, segIndex) {
    const hue = ((s.seed % 360) + segIndex * 6) % 360;
    line(ctx, from, to, `hsl(${hue} 100% 55%)`, s.size);
  }
}

class PixelBrush extends BaseBrush {
  drawSegment(ctx, from, to, s) {
    const cell = Math.max(3, Math.round(s.size / 2));
    const { len } = segFrame(from, to);
    const steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
    ctx.fillStyle = s.color;
    let lastKey = null;
    for (let st = 0; st <= steps; st++) {
      const t = st / steps;
      const gx = Math.floor((from.x + (to.x - from.x) * t) / cell) * cell;
      const gy = Math.floor((from.y + (to.y - from.y) * t) / cell) * cell;
      const key = gx + "," + gy;
      if (key !== lastKey) {
        ctx.fillRect(gx, gy, cell, cell);
        lastKey = key;
      }
    }
  }
}

/** Internal brush used by the drip system: a run of paint that tapers as it
 *  travels. Not listed in the style dropdown. */
class DripBrush extends BaseBrush {
  drawSegment(ctx, from, to, s, segIndex) {
    const w = Math.max(1, s.size * Math.max(0.3, 1 - segIndex * 0.02));
    line(ctx, from, to, s.color, w);
  }
}

/** Internal brush used by the open-hand eraser gesture. */
class EraserBrush extends BaseBrush {
  drawSegment(ctx, from, to, s) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    line(ctx, from, to, "rgba(0,0,0,1)", s.size);
    ctx.restore();
  }

  drawDot(ctx, point, s) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(point.x, point.y, s.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export const BRUSHES = {
  solid: new SolidBrush(),
  paint: new PaintBrush(),
  spray: new SprayBrush(),
  gooey: new GooeyBrush(),
  steam: new SteamBrush(),
  toothpaste: new ToothpasteBrush(),
  neon: new NeonBrush(),
  rainbow: new RainbowBrush(),
  pixel: new PixelBrush(),
  drip: new DripBrush(),
  eraser: new EraserBrush(),
};

export function getBrush(name) {
  return BRUSHES[name] ?? BRUSHES.solid;
}
