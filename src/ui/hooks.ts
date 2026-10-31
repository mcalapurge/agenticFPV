// React ↔ engine glue.

import { useEffect, useReducer, useRef, useState } from 'react';
import type { Simulator } from '../engine/Simulator';
import { useSim } from '../state/engineStore';
import { getPath, type ConfigPath, type PathValue, type Config } from '../state/configSchema';
import { useConfigStore } from '../state/configStore';
import { detectTouchDevice, touchEnabled } from '../engine/input/device';

/** Run `fn` after every simulator frame (for imperative DOM/canvas updates; no React re-render). */
export function useSimFrame(fn: (sim: Simulator) => void): void {
  const sim = useSim();
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => sim?.onFrame((s) => ref.current(s)), [sim]);
}

/** Re-render the component at most `hz` times per second while frames are running. */
export function useFrameTick(hz = 15): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const last = useRef(0);
  useSimFrame(() => {
    const now = performance.now();
    if (now - last.current >= 1000 / hz) {
      last.current = now;
      bump();
    }
  });
  return tick;
}

/** Subscribe to one config value by path. */
export function useConfigValue<P extends ConfigPath>(path: P): PathValue<Config, P> {
  return useConfigStore((s) => getPath(s.config, path));
}

/** Setter for a config path. */
export function setConfigValue<P extends ConfigPath>(path: P, value: PathValue<Config, P>): void {
  useConfigStore.getState().setPath(path, value);
}

/** Are the on-screen touch controls on? (The player's setting, or device detection when it is 'auto'.) */
export function useTouchEnabled(): boolean {
  const mode = useConfigStore((s) => s.config.input.touch.mode);
  const [detected] = useState(() => detectTouchDevice());
  return touchEnabled(mode, detected);
}

/** Whether this device looks like a phone/tablet (what 'auto' resolves to). */
export function useTouchDetected(): boolean {
  const [detected] = useState(() => detectTouchDevice());
  return detected;
}
