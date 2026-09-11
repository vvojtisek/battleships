import { useState } from 'react';

interface Props {
  readonly children: React.ReactNode;
  readonly onForfeit: () => Promise<void> | void;
  readonly mode: 'Single player' | 'LAN multiplayer';
  readonly settings?: React.ReactNode;
}

export function MatchFrame({ children, onForfeit, mode, settings }: Props) {
  const [paused, setPaused] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);

  async function forfeit(): Promise<void> {
    setForfeiting(true);
    await onForfeit();
  }

  return (
    <>
      <header className="match-bar">
        <span>{mode}</span>
        <button onClick={() => setPaused(true)} type="button">
          Pause match
        </button>
      </header>
      {children}
      {paused && (
        <div
          aria-modal="true"
          className="pause-backdrop"
          role="dialog"
          aria-labelledby="pause-title"
        >
          <section className="pause-modal">
            <p className="eyebrow">Match paused</p>
            <h2 id="pause-title">Keep your fleet on course?</h2>
            <p>Navigation is locked while a match is active. Resume, or intentionally surrender.</p>
            {settings && <div className="pause-settings">{settings}</div>}
            <div className="button-row">
              <button
                className="primary-button"
                disabled={forfeiting}
                onClick={() => setPaused(false)}
                type="button"
              >
                Resume
              </button>
              <button
                className="danger-button"
                disabled={forfeiting}
                onClick={() => void forfeit()}
                type="button"
              >
                {forfeiting ? 'Surrendering…' : 'Surrender match'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
