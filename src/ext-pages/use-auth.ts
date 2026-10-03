import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { call, CallError } from '../github/client';
import type { ErrorInfo } from '../github/messages';

export interface Flow {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
}
export interface Status {
  signedIn: boolean;
  login?: string;
  avatarUrl?: string;
  kind?: string;
  flow?: Flow;
}

export const toInfo = (e: unknown): ErrorInfo => (e instanceof CallError ? e.info : { kind: 'other', message: e instanceof Error ? e.message : String(e) });

/** Sign-in state shared by the popup and the options page. The device flow survives the page closing (the background keeps it). */
export function useAuth() {
  const [status, setStatus] = useState<Status | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);

  const poll = (f: Flow, delay = f.interval * 1000) => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const r = await call<any>({ type: 'auth:poll', deviceCode: f.deviceCode, interval: f.interval });
        if (!alive.current) return;
        if (r.state === 'pending') return poll({ ...f, interval: r.interval });
        setFlow(null);
        if (r.state === 'error') return setError({ kind: 'other', message: r.message });
        setStatus(r);
      } catch (e) {
        if (!alive.current) return;
        setFlow(null);
        setError(toInfo(e));
      }
    }, delay);
  };

  useEffect(() => {
    alive.current = true;
    call<Status>({ type: 'auth:status' })
      .then((s) => {
        if (!alive.current) return;
        setStatus(s);
        // Pick a pending sign-in up again (the popup closes when the GitHub tab opens).
        if (!s.signedIn && s.flow) {
          setFlow(s.flow);
          poll(s.flow, 0);
        }
      })
      .catch((e) => alive.current && (setStatus({ signedIn: false }), setError(toInfo(e))));
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  return {
    status,
    flow,
    error,
    setError,
    async start() {
      setError(null);
      try {
        const f = await call<Flow>({ type: 'auth:start' });
        setFlow(f);
        poll(f);
      } catch (e) {
        setError(toInfo(e));
      }
    },
    async signOut() {
      try {
        setStatus(await call<Status>({ type: 'auth:signout' }));
      } catch (e) {
        setError(toInfo(e));
      }
    },
    /** Saves a personal access token; resolves with the new status, or null (and sets `error`) when GitHub or the org rejects it. */
    async savePat(token: string): Promise<Status | null> {
      setError(null);
      try {
        const s = await call<Status>({ type: 'auth:pat', token });
        setStatus(s);
        return s;
      } catch (e) {
        setError(toInfo(e));
        return null;
      }
    },
    openDevicePage: (f: Flow) => browser.tabs.create({ url: f.verificationUri }),
  };
}
