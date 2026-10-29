// Mini "blackbox": setpoint vs filtered gyro trace for roll/pitch/yaw (toggle with B).

import { useRef } from 'react';
import { useUiStore } from '../../state/uiStore';
import { useSimFrame } from '../hooks';

const N = 240;

export function Blackbox() {
  const visible = useUiStore((s) => s.blackbox);
  const ref = useRef<HTMLCanvasElement>(null);
  const history = useRef<number[][]>([]);
  useSimFrame((sim) => {
    const { setpoint, gyro } = sim.fc;
    const h = history.current;
    h.push([setpoint[0], gyro[0], setpoint[1], gyro[1], setpoint[2], gyro[2]]);
    if (h.length > N) h.shift();
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!visible || !cv || !ctx) return;
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const rh = H / 3;
    let max = 200;
    for (const row of h) for (const v of row) max = Math.max(max, Math.abs(v));
    ctx.font = '11px monospace';
    ['ROLL', 'PITCH', 'YAW'].forEach((name, r) => {
      const mid = rh * r + rh / 2;
      ctx.strokeStyle = '#333';
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(W, mid);
      ctx.stroke();
      for (const [idx, col] of [
        [r * 2, '#ffcc00'],
        [r * 2 + 1, '#22c8ff'],
      ] as const) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        h.forEach((row, i) => {
          const x = (i / N) * W;
          const y = mid - (row[idx] / max) * (rh / 2 - 4);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      }
      ctx.fillStyle = '#ccc';
      ctx.fillText(name, 4, rh * r + 12);
    });
    ctx.fillStyle = '#ffcc00';
    ctx.fillText('setpoint', W - 120, 12);
    ctx.fillStyle = '#22c8ff';
    ctx.fillText('gyro', W - 50, 12);
  });
  return <canvas id="blackbox" ref={ref} width={420} height={210} className={visible ? 'show' : ''} />;
}
