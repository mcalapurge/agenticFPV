import { useConfigStore } from '../../state/configStore';
import { toast, useUiStore } from '../../state/uiStore';
import { downloadJson, pickJsonFile } from './io';
import { TABS } from './tabList';

export function Menu() {
  const open = useUiStore((s) => s.menuOpen);
  const tab = useUiStore((s) => s.tab);
  const setTab = useUiStore((s) => s.setTab);
  const close = useUiStore((s) => s.closeMenu);
  if (!open) return null;
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const { Component } = active;
  return (
    <div id="menu" role="dialog" aria-label="Settings">
      <div className="panel">
        <header>
          <h1>
            agentic<span>FPV</span>
          </h1>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={t.id === tab} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </header>
        <div className="body" role="tabpanel">
          <Component key={active.id} />
        </div>
        <footer>
          <button className="btn" disabled={!active.resets.length} onClick={() => useConfigStore.getState().reset(active.resets)}>
            Reset tab to defaults
          </button>
          <button className="btn" onClick={() => downloadJson('agenticfpv-config.json', useConfigStore.getState().config)}>
            Export JSON
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                const json = await pickJsonFile();
                if (json === undefined) return;
                useConfigStore.getState().replace(json);
                toast('Config imported ✔');
              } catch (err) {
                toast(`Import failed: ${(err as Error).message}`);
              }
            }}
          >
            Import JSON
          </button>
          <span className="spacer" />
          <span className="hint">Changes apply live and are saved automatically · </span>
          <button className="btn primary" onClick={close}>
            Fly ▶
          </button>
        </footer>
      </div>
    </div>
  );
}
