export function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  return typeof configured === 'string'
    ? configured
    : `${window.location.protocol}//${window.location.hostname}:3000`;
}

export function serverRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, serverUrl()), init);
}

export function authorization(token: string | null): Readonly<Record<string, string>> {
  return token ? { authorization: `Bearer ${token}` } : {};
}
