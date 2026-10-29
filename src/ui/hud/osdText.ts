// OSD text for each screen slot, derived from the simulator state.

import { fmtTime } from '../../engine/format';
import type { Simulator } from '../../engine/Simulator';

export type Slot = 'tl' | 'tr' | 'bl' | 'br' | 'tc' | 'warn' | 'lap' | 'perf';
export const SLOTS: Slot[] = ['tl', 'tr', 'bl', 'br', 'tc', 'warn', 'lap', 'perf'];

export function osdText(sim: Simulator): Record<Slot, string> {
  const cfg = sim.config;
  const { quad, fc, state, hud, perf, gpu } = sim;
  const b = quad.battery;
  const cells = cfg.physics.cells;
  const link =
    cfg.video.system === 'digital'
      ? `LQ ${(state.signal * 100).toFixed(0)}%`
      : `RSSI ${(state.signal * 99).toFixed(0)}`;
  return {
    tl: `${b.voltage.toFixed(1)}V  ${(b.voltage / cells).toFixed(2)}v\n${b.current.toFixed(0).padStart(3)}A ${b.usedMah.toFixed(0)}mAh\n${link}`,
    tr: `${fmtTime(state.flightTime)}\n${cfg.flight.mode === 'angle' ? 'ANGL' : 'ACRO'}`,
    bl: `${quad.speedKmh.toFixed(0).padStart(3)} KM/H\n${quad.pos.y.toFixed(1).padStart(5)} M`,
    br: `THR ${(fc.throttle * 100).toFixed(0).padStart(3)}%`,
    tc: state.armed ? '' : 'DISARMED',
    warn: hud.warning,
    lap: hud.lap,
    perf: cfg.camera.showPerf
      ? `${(1000 / Math.max(1e-3, perf.frameMs)).toFixed(0)} FPS  ${perf.frameMs.toFixed(1)}ms\nPHYS ${perf.physMs.toFixed(2)}ms (${perf.steps} steps)\nRENDER CPU ${perf.renderMs.toFixed(2)}ms\n${gpu.software ? 'SOFTWARE GL' : gpu.label.slice(0, 28).toUpperCase()}`
      : '',
  };
}
