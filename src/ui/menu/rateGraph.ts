// Rate-curve plot used by the Rates tab.

import { applyRate } from '../../engine/sim/rates';
import type { Axis, Config } from '../../state/configSchema';

export const AXES: Axis[] = ['roll', 'pitch', 'yaw'];
const COLORS: Record<Axis, string> = { roll: '#ff7a1a', pitch: '#22c8ff', yaw: '#46d37b' };

/** Draw the three rate curves plus live stick markers. */
export function drawRateCurves(
  ctx: CanvasRenderingContext2D,
  rates: Config['rates'],
  sticks?: Record<Axis, number>,
): number {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#2c313a';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (H * i) / 4);
    ctx.lineTo(W, (H * i) / 4);
    ctx.moveTo((W * i) / 4, 0);
    ctx.lineTo((W * i) / 4, H);
    ctx.stroke();
  }
  let maxAll = 200;
  for (const ax of AXES) maxAll = Math.max(maxAll, Math.abs(applyRate(rates.type, 1, rates[ax])));
  maxAll = Math.ceil(maxAll / 200) * 200;
  for (const ax of AXES) {
    ctx.strokeStyle = COLORS[ax];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const s = i / 100;
      const y = H - (applyRate(rates.type, s, rates[ax]) / maxAll) * H;
      if (i) ctx.lineTo(s * W, y);
      else ctx.moveTo(s * W, y);
    }
    ctx.stroke();
    if (sticks) {
      const s = Math.abs(sticks[ax]);
      ctx.fillStyle = COLORS[ax];
      ctx.beginPath();
      ctx.arc(s * W, H - (applyRate(rates.type, s, rates[ax]) / maxAll) * H, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#8b929c';
  ctx.font = '12px sans-serif';
  ctx.fillText(`${maxAll}°/s`, 6, 14);
  ctx.fillText('stick →', W - 50, H - 6);
  return maxAll;
}
