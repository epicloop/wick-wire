// Tiny in-process TTL cache with in-flight de-duplication. Fluid Compute reuses instances,
// so this absorbs repeat page views; every upstream is additionally rate/cost capped.
type Entry = { at: number; ttl: number; value?: unknown; pending?: Promise<unknown> };

const g = globalThis as unknown as { __wwCache?: Map<string, Entry> };
const store = (g.__wwCache ??= new Map());

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && "value" in hit && now - hit.at < hit.ttl) return hit.value as T;
  if (hit?.pending) return hit.pending as Promise<T>;
  const pending = fn()
    .then((value) => {
      store.set(key, { at: Date.now(), ttl: ttlMs, value });
      return value;
    })
    .catch((e) => {
      // Keep serving the previous good value (if any) when a refresh fails.
      if (hit && "value" in hit) store.set(key, { ...hit, pending: undefined });
      else store.delete(key);
      throw e;
    });
  store.set(key, { ...(hit ?? { at: 0, ttl: ttlMs }), pending });
  return pending;
}

export function peek<T>(key: string): T | undefined {
  const hit = store.get(key);
  return hit && "value" in hit ? (hit.value as T) : undefined;
}

/** Serialises calls to a rate-limited upstream: at most one call every `gapMs`. */
export function throttle(gapMs: number) {
  let chain = Promise.resolve();
  let last = 0;
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    chain = run.catch(() => undefined);
    return run.then(fn);
  };
}
