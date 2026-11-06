// Minimal in-memory stand-in for the @upstash/redis calls lib/ uses.
export function createFakeRedis() {
  const store = new Map<string, { value: unknown; expiresAt?: number }>();
  const live = (key: string) => {
    const e = store.get(key);
    if (e?.expiresAt !== undefined && Date.now() >= e.expiresAt) store.delete(key);
    return store.get(key);
  };
  // Upstash JSON-serializes values, so Dates and Maps don't survive the trip
  const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));
  const get = async (key: string) => roundTrip(live(key)?.value);
  return {
    store,
    get,
    mget: async (...keys: string[]) => Promise.all(keys.map(get)),
    set: async (key: string, value: unknown, opts: { px?: number; ex?: number; nx?: boolean } = {}) => {
      if (opts.nx && live(key)) return null;
      const ttl = opts.px ?? (opts.ex !== undefined ? opts.ex * 1000 : undefined);
      store.set(key, { value: roundTrip(value), expiresAt: ttl === undefined ? undefined : Date.now() + ttl });
      return 'OK';
    },
    // Only the rate-limit script is supported: INCR + PEXPIRE on first hit, returns [count, pttl]
    eval: async (_script: string, [key]: string[], [windowMs]: number[]) => {
      const e = live(key);
      const count = ((e?.value as number) ?? 0) + 1;
      const expiresAt = e?.expiresAt ?? Date.now() + windowMs;
      store.set(key, { value: count, expiresAt });
      return [count, expiresAt - Date.now()];
    },
  };
}
