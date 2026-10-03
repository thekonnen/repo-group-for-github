/** GitHub navigates with Turbo (no full page loads), so URL changes come from events plus a safety net. */
export function watchUrl(cb: () => void, win: Window = window): () => void {
  let last = '';
  const check = () => {
    if (win.location.href !== last) {
      last = win.location.href;
      cb();
    }
  };
  const force = () => {
    last = win.location.href;
    cb();
  };
  const events: [EventTarget, string, EventListener][] = [
    [win.document, 'turbo:load', force], // Turbo replaced the page, even for the same URL
    [win.document, 'turbo:render', force],
    [win, 'popstate', check],
    [win, 'hashchange', check],
  ];
  events.forEach(([t, n, f]) => t.addEventListener(n, f));
  // Navigation API (Chromium) catches client-side routing; elsewhere a slow check is the net.
  const nav = (win as any).navigation as EventTarget | undefined;
  nav?.addEventListener('navigatesuccess', check);
  const timer = nav ? 0 : win.setInterval(check, 2000);
  force();
  return () => {
    events.forEach(([t, n, f]) => t.removeEventListener(n, f));
    nav?.removeEventListener('navigatesuccess', check);
    if (timer) win.clearInterval(timer);
  };
}

/** Resolves when `find` returns something, watching DOM changes only while waiting (nothing left running after). */
export function waitFor<T>(find: () => T | null, timeoutMs = 8000, doc: Document = document): Promise<T | null> {
  const now = find();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    let scheduled = false;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      obs.disconnect();
      clearTimeout(timer);
      resolve(v);
    };
    const obs = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        const v = find();
        if (v) finish(v);
      }, 50);
    });
    obs.observe(doc.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(find()), timeoutMs);
  });
}
