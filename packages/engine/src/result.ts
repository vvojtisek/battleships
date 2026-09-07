export type Result<T, C extends string = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: C; readonly detail: string };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <C extends string>(code: C, detail: string): Result<never, C> => ({
  ok: false,
  code,
  detail,
});
