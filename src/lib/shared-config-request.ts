// Share only concurrent, read-only configuration requests. Completed responses
// are not cached, so an explicit refresh still reads the current server state.
const pending = new Map<string, Promise<unknown>>();

export function fetchSharedConfig<T>(url: string, fallbackError: string, useServerError = true): Promise<T> {
  const existing = pending.get(url);
  if (existing) return existing as Promise<T>;

  const request = fetch(url, { cache: "no-store" })
    .then(async response => {
      const body = await response.json().catch(() => { throw new Error(fallbackError); });
      if (!response.ok || body?.error) {
        throw new Error(useServerError && typeof body?.error === "string" ? body.error : fallbackError);
      }
      return body as T;
    })
    .finally(() => { pending.delete(url); });

  pending.set(url, request);
  return request;
}
