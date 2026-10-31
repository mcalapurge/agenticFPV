// What the demo flies: the quad class the player picked, with its stock physics and tune, and none of
// the player's personal edits (a broken PID tune must not crash the title-screen demo).

import { DEFAULT_CONFIG, type Config } from '../../state/configSchema';
import { applyPreset } from '../sim/presets';

export function demoSimConfig(cfg: Config): Config {
  const stock = structuredClone(DEFAULT_CONFIG);
  applyPreset(stock, cfg.quad.preset);
  return {
    ...cfg,
    quad: stock.quad,
    pid: stock.pid,
    rates: stock.rates,
    filters: stock.filters,
    flight: stock.flight,
    physics: { ...stock.physics, battery: false, crashEnabled: false, windSpeed: 2, windGust: 0.3 },
  };
}

/** How the pilot should fly this airframe: hover throttle and cruise-speed scale. */
export function pilotVehicle(cfg: Config): { hoverThrottle: number; speedScale: number } {
  const p = cfg.physics;
  const thrustToWeight = (p.motorThrustG * 4) / p.massG;
  return {
    // Thrust ∝ throttle², so hover sits at sqrt(1 / T:W).
    hoverThrottle: Math.sqrt(1 / thrustToWeight),
    // Small, weak quads cruise slower (and the 5" classes keep the full route speed).
    speedScale: Math.min(1, Math.max(0.35, Math.sqrt(thrustToWeight / 9))),
  };
}
