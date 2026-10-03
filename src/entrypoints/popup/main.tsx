import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { Request, Response } from '../../github/messages';

const send = <T,>(req: Request): Promise<Response<T>> => browser.runtime.sendMessage(req);

interface Status { signedIn: boolean; login?: string; avatarUrl?: string; kind?: string }
interface Flow { deviceCode: string; userCode: string; verificationUri: string; interval: number }

function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    send<Status>({ type: 'auth:status' }).then((r) => r.ok && setStatus(r.data));
    return () => clearTimeout(timer.current);
  }, []);

  const poll = (f: Flow) => {
    timer.current = window.setTimeout(async () => {
      const r = await send<any>({ type: 'auth:poll', deviceCode: f.deviceCode, interval: f.interval });
      if (!r.ok) return setError(r.error.message), setFlow(null);
      if (r.data.state === 'pending') return poll({ ...f, interval: r.data.interval });
      if (r.data.state === 'error') return setError(r.data.message), setFlow(null);
      setFlow(null);
      setStatus(r.data);
    }, f.interval * 1000);
  };

  const start = async () => {
    setError('');
    const r = await send<Flow>({ type: 'auth:start' });
    if (!r.ok) return setError(r.error.message);
    setFlow(r.data);
    poll(r.data);
  };

  const signOut = async () => {
    const r = await send<Status>({ type: 'auth:signout' });
    if (r.ok) setStatus(r.data);
  };

  return (
    <main>
      <h1><img src="/icon/48.png" alt="" />Repository Group for Github</h1>
      {status?.signedIn ? (
        <div class="row">
          {status.avatarUrl && <img class="av" src={status.avatarUrl} alt="" />}
          <span>{status.login}</span>
          <span class="muted">{status.kind === 'pat' ? 'token' : 'GitHub App'}</span>
          <span style="flex:1" />
          <button onClick={signOut}>Sign out</button>
        </div>
      ) : flow ? (
        <>
          <span class="muted">Enter this code on GitHub to finish signing in.</span>
          <div class="code" aria-live="polite">{flow.userCode}</div>
          <button class="primary" onClick={() => browser.tabs.create({ url: flow.verificationUri })}>Open github.com/login/device</button>
          <span class="muted">Waiting for you to authorize…</span>
        </>
      ) : status ? (
        <>
          <span class="muted">Sign in to see your organization's repositories in groups.</span>
          <button class="primary" onClick={start}>Sign in with GitHub</button>
        </>
      ) : null}
      {error && <span class="err" role="alert">{error}</span>}
    </main>
  );
}

render(<App />, document.getElementById('app')!);
