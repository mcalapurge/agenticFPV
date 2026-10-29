// Shape of the `window.__fpv` automation/debug handle (see src/main.tsx).

import type { Simulator } from './engine/Simulator';
import type { Config } from './state/configSchema';
import type { useUiStore } from './state/uiStore';

export interface DebugApi {
  sim: Simulator;
  config: () => Config;
  update: (recipe: (draft: Config) => void) => void;
  ui: typeof useUiStore;
}

declare global {
  interface Window {
    __fpv?: DebugApi;
  }
}
