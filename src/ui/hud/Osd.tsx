// Betaflight-style OSD. Text is written straight into the DOM every frame (no React re-render).

import { useRef } from 'react';
import { useConfigStore } from '../../state/configStore';
import { useSimFrame } from '../hooks';
import { osdText, SLOTS, type Slot } from './osdText';

export function Osd() {
  const show = useConfigStore((s) => s.config.camera.showOsd);
  const refs = useRef<Partial<Record<Slot, HTMLDivElement | null>>>({});
  useSimFrame((sim) => {
    const text = osdText(sim);
    for (const k of SLOTS) {
      const el = refs.current[k];
      if (el && el.textContent !== text[k]) el.textContent = text[k];
    }
    refs.current.warn?.classList.toggle('blink', !!text.warn);
    refs.current.lap?.classList.toggle('big', sim.hud.bigCountdown);
    refs.current.perf?.classList.toggle('hidden', !text.perf);
  });
  return (
    <div id="osd" data-testid="osd" style={{ display: show ? undefined : 'none' }}>
      {SLOTS.map((k) => (
        <div key={k} className={`el ${k}`} data-testid={`osd-${k}`} ref={(el) => void (refs.current[k] = el)} />
      ))}
      <div className="el center">─┼─</div>
    </div>
  );
}
