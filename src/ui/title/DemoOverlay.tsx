// Demo screen: the autopilot flies full-screen; any key or click returns to the title menu.

import { useEffect } from 'react';
import { useUiStore } from '../../state/uiStore';

export function DemoOverlay() {
  const screen = useUiStore((s) => s.screen);
  useEffect(() => {
    if (screen !== 'demo') return;
    const exit = () => useUiStore.getState().setScreen('title');
    const onKey = (e: KeyboardEvent) => {
      // Ignore auto-repeat (the Enter that started the demo may still be held) and bare modifiers.
      if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      exit();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', exit);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', exit);
    };
  }, [screen]);

  if (screen !== 'demo') return null;
  return (
    <div id="demo-hint" data-testid="demo-hint">
      DEMO · press any key to go back
    </div>
  );
}
