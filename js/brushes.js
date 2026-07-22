/**
 * Brush registry. A brush knows how to render one segment of a stroke onto a
 * 2D canvas context. New styles (spray, ribbon, glow, ...) can be added by
 * implementing the same interface and registering them here.
 *
 * Brush interface:
 *   drawSegment(ctx, from, to, settings)
 *     - from / to: {x, y} in canvas pixel coordinates
 *     - settings:  {color, size}
 *   drawDot(ctx, point, settings)
 *     - used for single-point strokes (a tap with no movement)
 */

class SolidBrush {
  drawSegment(ctx, from, to, settings) {
    ctx.strokeStyle = settings.color;
    ctx.lineWidth = settings.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  drawDot(ctx, point, settings) {
    ctx.fillStyle = settings.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, settings.size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export const BRUSHES = {
  solid: new SolidBrush(),
};

export function getBrush(name) {
  return BRUSHES[name] ?? BRUSHES.solid;
}
