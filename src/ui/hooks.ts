// React ↔ engine glue.

import { useEffect, useReducer, useRef } from 'react';
import type { Simulator } from '../engine/Simulator';
import { useSim } from '../state/engineStore';
import { getPath, type ConfigPath, type PathValue, type Config } from '../state/configSchema';
import { useConfigStore } from '../state/configStore';

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
