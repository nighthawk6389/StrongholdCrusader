import { useState } from 'react';
import { audio } from '../audio/AudioEngine';
import { DEFAULT_SETTINGS, getSettings, updateSettings, type Settings } from '../game/settings';

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="set-row">
      <span className="set-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="set-value">{format(value)}</span>
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="set-row toggle">
      <span className="set-label">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const times = (v: number): string => `${v.toFixed(1)}×`;

/** Settings: sound, graphics, camera, direct control, hints. Changes apply (and save) at once. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Settings>(getSettings());
  const set = (patch: Partial<Settings>): void => setS(updateSettings(patch));
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel modal settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        <h3>Sound</h3>
        <Slider label="Master" value={s.master} min={0} max={1} step={0.05} format={pct} onChange={(v) => set({ master: v })} />
        <Slider
          label="Effects"
          value={s.sfx}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={(v) => {
            set({ sfx: v });
            audio.unlock();
            audio.play('rifle', undefined, undefined, 0.6);
          }}
        />
        <Slider label="Music" value={s.music} min={0} max={1} step={0.05} format={pct} onChange={(v) => set({ music: v })} />
        <h3>Graphics</h3>
        <div className="set-row">
          <span className="set-label">Quality</span>
          <div className="segmented">
            {(['auto', 'low', 'high'] as const).map((q) => (
              <button key={q} type="button" className={`seg ${s.quality === q ? 'active' : ''}`} onClick={() => set({ quality: q })}>
                {q === 'auto' ? 'Auto' : q === 'low' ? 'Low (faster)' : 'High (shadows)'}
              </button>
            ))}
          </div>
        </div>
        <Toggle
          label="Lighting effects on High (soft corner shadows, glow, colour grading)"
          value={s.effects}
          onChange={(v) => set({ effects: v })}
        />
        <p className="muted small set-note">Graphics changes apply the next time a game starts.</p>
        <h3>Camera</h3>
        <Slider label="Pan speed" value={s.panSpeed} min={0.4} max={2.5} step={0.1} format={times} onChange={(v) => set({ panSpeed: v })} />
        <Slider label="Rotate speed" value={s.rotateSpeed} min={0.4} max={2.5} step={0.1} format={times} onChange={(v) => set({ rotateSpeed: v })} />
        {!touch && <Toggle label="Scroll at screen edges" value={s.edgePan} onChange={(v) => set({ edgePan: v })} />}
        <h3>Direct control</h3>
        <Slider label="Look sensitivity" value={s.lookSensitivity} min={0.3} max={3} step={0.1} format={times} onChange={(v) => set({ lookSensitivity: v })} />
        <Toggle label="Invert vertical look" value={s.invertLook} onChange={(v) => set({ invertLook: v })} />
        <h3>Help</h3>
        <Toggle label="Show the help card when a game starts" value={s.showHints} onChange={(v) => set({ showHints: v })} />
        <div className="row end">
          <button type="button" className="btn" onClick={() => set({ ...DEFAULT_SETTINGS })}>
            Reset to defaults
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
