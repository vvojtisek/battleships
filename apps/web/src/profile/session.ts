export interface SessionState {
  readonly profile: { readonly username: string; readonly points: number } | null;
  readonly guest: boolean;
}

export function isActiveSession({ profile, guest }: SessionState): boolean {
  return profile !== null || guest;
}

export function activeUserLabel({ profile, guest }: SessionState): string {
  if (profile) return profile.username;
  return guest ? 'Guest captain' : 'No active player';
}
