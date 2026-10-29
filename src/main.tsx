import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulator } from './engine/Simulator';
import { useConfigStore } from './state/configStore';
import { useEngineStore } from './state/engineStore';
import { toast, useUiStore } from './state/uiStore';
import { App } from './ui/App';
import './ui/styles.css';

createRoot(document.getElementById('ui-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const sim = await Simulator.create(canvas);
useEngineStore.getState().setSim(sim);
useUiStore.getState().setLoading(null);
sim.start();
toast('Esc = settings · Space = arm (keyboard) · R = reset · C = camera · P = replay · H = help', 6000);

// Debug / automation handle (used by the Playwright suite).
window.__fpv = {
  sim,
  config: () => useConfigStore.getState().config,
  update: (recipe) => useConfigStore.getState().update(recipe),
  ui: useUiStore,
};

if (import.meta.hot) import.meta.hot.dispose(() => sim.dispose());
