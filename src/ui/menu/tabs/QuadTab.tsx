import { applyPreset, QUAD_PRESETS, type QuadPreset } from '../../../engine/sim/presets';
import { useConfigStore } from '../../../state/configStore';
import { toast } from '../../../state/uiStore';
import { Section } from '../fields';

export function QuadTab() {
  const current = useConfigStore((s) => s.config.quad.preset);
  const update = useConfigStore((s) => s.update);
  return (
    <Section title="Quad class">
      <div className="cards">
        {(Object.entries(QUAD_PRESETS) as [string, QuadPreset][]).map(([id, p]) => {
          const ph = p.physics;
          const tw = (((ph.motorThrustG ?? 0) * 4) / (ph.massG ?? 1)).toFixed(1);
          return (
            <button
              key={id}
              className={`card${id === current ? ' active' : ''}`}
              data-testid={`preset-${id}`}
              onClick={() => {
                update((d) => applyPreset(d, id));
                toast(`${p.name} selected`);
              }}
            >
              <b>{p.name}</b>
              <span>
                {ph.massG} g · {ph.propInches}" {p.model.blades}-blade · {ph.cells}S
              </span>
              <span>
                T:W {tw}:1 · {(ph.armLengthMm ?? 0) * 2} mm wheelbase
              </span>
            </button>
          );
        })}
      </div>
      <p className="hint">
        Selecting a class loads its airframe physics and a matching PID tune (your rates are kept). Fine-tune anything
        afterwards in the Physics / PIDs tabs.
      </p>
    </Section>
  );
}
