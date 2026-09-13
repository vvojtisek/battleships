import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AppNav } from './AppNav.js';

interface Props {
  readonly children: React.ReactNode;
  readonly onForfeit: () => Promise<void> | void;
  readonly mode: 'Single player' | 'LAN multiplayer';
  readonly phase: 'active' | 'over';
  readonly canForfeit: boolean;
  readonly settings?: React.ReactNode;
}

export function MatchFrame({ children, onForfeit, mode, phase, canForfeit, settings }: Props) {
  const navigate = useNavigate();
  const [paused, setPaused] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);

  async function forfeit(): Promise<void> {
    setForfeiting(true);
    try {
      await onForfeit();
    } finally {
      setForfeiting(false);
    }
  }

  return (
    <>
      {phase === 'over' && <AppNav />}
      <header className="match-bar">
        <span>{mode}</span>
        {phase === 'over' ? (
          <button onClick={() => void navigate('/menu')} type="button">
            Leave match
          </button>
        ) : (
          <button onClick={() => setPaused(true)} type="button">
            Pause match
          </button>
        )}
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
            <p>
              {canForfeit
                ? 'Navigation is locked while a match is active. Resume, or intentionally surrender.'
                : 'Finish arranging your fleet, or leave this unfinished match without a penalty.'}
            </p>
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
              {canForfeit ? (
                <button
                  className="danger-button"
                  disabled={forfeiting}
                  onClick={() => void forfeit()}
                  type="button"
                >
                  {forfeiting ? 'Surrendering…' : 'Surrender match'}
                </button>
              ) : (
                <button
                  className="danger-button"
                  onClick={() => void navigate('/menu')}
                  type="button"
                >
                  Leave match
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
