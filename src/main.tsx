import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulator } from './engine/Simulator';
import { useConfigStore } from './state/configStore';
import { useEngineStore } from './state/engineStore';
import { useUiStore } from './state/uiStore';
import { App } from './ui/App';
import './ui/styles.css';

createRoot(document.getElementById('ui-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline play + home-screen install (production builds only; dev uses Vite's own server).
// Registered before the slow world build below: the page's `load` event can fire while that is still awaited.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const register = () => navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => undefined);
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

const canvas = document.getElementById('view') as HTMLCanvasElement;
const sim = await Simulator.create(canvas);
useEngineStore.getState().setSim(sim);
useUiStore.getState().setLoading(null);
sim.start();

// Debug / automation handle (used by the Playwright suite).
window.__fpv = {
  sim,
  config: () => useConfigStore.getState().config,
  update: (recipe) => useConfigStore.getState().update(recipe),
  ui: useUiStore,
};

if (import.meta.hot) import.meta.hot.dispose(() => sim.dispose());
