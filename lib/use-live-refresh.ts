'use client';

import { useEffect, useState } from 'react';

// Returns a counter that increments on an interval while the tab is visible,
// and immediately when the tab regains focus/visibility. Include it in a fetch
// effect's dependency array to make that data live-refresh (offers arriving,
// items selling, new listings) without sockets. Bumps are throttled so a
// focus + visibilitychange pair doesn't double-fetch.
export function useLiveRefresh(intervalMs: number, enabled = true): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    const bump = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last < 1_000) return;
      last = now;
      setTick((t) => t + 1);
    };
    const id = setInterval(bump, intervalMs);
    document.addEventListener('visibilitychange', bump);
    window.addEventListener('focus', bump);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', bump);
      window.removeEventListener('focus', bump);
    };
  }, [intervalMs, enabled]);

  return tick;
}
