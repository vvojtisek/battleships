export interface SessionState {
  readonly profile: { readonly username: string; readonly points: number } | null;
  readonly guest: boolean;
  readonly offline?: boolean;
}

export function isGuestEntryRequest(search: string): boolean {
  return new URLSearchParams(search).get('guest') === '1';
}

export function isActiveSession({ profile, guest, offline = false }: SessionState): boolean {
  return profile !== null || guest || offline;
}

export function activeUserLabel({ profile, guest, offline = false }: SessionState): string {
  if (profile) return profile.username;
  if (guest) return 'Guest captain';
  return offline ? 'Offline captain' : 'No active player';
}
