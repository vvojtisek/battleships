export interface Spring {
  readonly type: 'spring';
  readonly mass: number;
  readonly stiffness: number;
  readonly damping: number;
}

/** Converts Apple's response/dampingRatio spring notation to physical parameters. */
export function appleSpring(response: number, dampingRatio: number, mass = 1): Spring {
  const omega = (2 * Math.PI) / response;
  return {
    type: 'spring',
    mass,
    stiffness: mass * omega * omega,
    damping: 2 * dampingRatio * mass * omega,
  };
}

export const SPRING = {
  snappy: appleSpring(0.3, 0.86),
  smooth: appleSpring(0.45, 1),
  bouncy: appleSpring(0.4, 0.65),
} as const;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** iOS has no general-purpose haptics API; Android vibration is a best-effort supplement. */
export function feedback(kind: 'light' | 'medium' | 'heavy' | 'success' | 'error'): void {
  if (prefersReducedMotion() || typeof navigator === 'undefined') return;
  const patterns = {
    light: [8],
    medium: [16],
    heavy: [28],
    success: [10, 32, 10],
    error: [28, 24, 28],
  } as const;
  navigator.vibrate(patterns[kind]);
}
