// Mode-2 stick overlay (bottom centre).

import { useRef } from 'react';
import { useConfigStore } from '../../state/configStore';
import { useSimFrame } from '../hooks';

export function StickOverlay() {
  const show = useConfigStore((s) => s.config.camera.showSticks);
  const ref = useRef<HTMLCanvasElement>(null);
  useSimFrame((sim) => {
    const cs = ref.current;
    const ctx = cs?.getContext('2d');
    if (!cs || !ctx || !show) return;
    const W = cs.width;
    const H = cs.height;
    const r = 48;
    ctx.clearRect(0, 0, W, H);
    const rc = sim.rc;
    const box = (cx: number, x: number, y: number) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - r, H / 2 - r, r * 2, r * 2);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx + x * r, H / 2 - y * r, 6, 0, Math.PI * 2);
      ctx.fill();
    };
    box(W / 2 - 70, rc.yaw, rc.throttle * 2 - 1);
    box(W / 2 + 70, rc.roll, rc.pitch);
  });
  return <canvas id="sticks" ref={ref} width={260} height={120} style={{ display: show ? undefined : 'none' }} />;
}
