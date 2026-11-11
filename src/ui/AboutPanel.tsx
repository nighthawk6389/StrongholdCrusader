/** Version, credits, privacy, and a way to wipe local progress. */
export function AboutPanel({ onClose }: { onClose: () => void }) {
  const reset = (): void => {
    if (!confirm('Delete your saved game, Commander\'s Trail progress, tutorial progress and settings on this device?')) return;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('siege-')) localStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
    location.reload();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel modal about" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="About">
        <div className="brand">
          <img src="/icon.svg" alt="" className="brand-emblem" width={48} height={48} />
          <div>
            <h2>Garrison Zero</h2>
            <div className="muted small">
              Version {__APP_VERSION__} · build {__BUILD_ID__}
            </div>
          </div>
        </div>
        <p>
          An original single-player castle-siege RTS set in the present day. Build an outpost, wall it in, and hold
          it by day and by night. Every model, sound and piece of music is generated in code.
        </p>
        <h3>Privacy</h3>
        <p className="small">
          No accounts, no ads, no tracking. Your saved game, settings and progress stay in this browser on this
          device. After the first visit the game also works offline.
        </p>
        <h3>Built with</h3>
        <p className="small muted">three.js, React, zustand and Vite (all MIT licensed).</p>
        <div className="row end">
          <button type="button" className="btn danger" onClick={reset}>
            Reset all progress
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
