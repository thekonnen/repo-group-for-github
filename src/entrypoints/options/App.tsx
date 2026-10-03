import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { t } from '../../i18n';
import { GEMINI_KEYS_URL, llmOrigin, type LlmStatus } from '../../background/llm';
import { call } from '../../github/client';
import { toInfo, useAuth } from '../../ext-pages/use-auth';
import type { OrgEntry, OrgList } from '../../background/orgs';
import type { OrgPrefs } from '../../github/messages';

function Account({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const s = auth.status;
  return (
    <section aria-labelledby="h-account">
      <h2 id="h-account">{t('optionsAccount')}</h2>
      {s?.signedIn ? (
        <div class="rg-ext-row">
          {s.avatarUrl && <img class="rg-ext-av" src={s.avatarUrl} alt="" />}
          <span class="grow">{s.login}</span>
          <span class="rg-ext-muted">{s.kind === 'pat' ? t('accountKindToken') : t('accountKindApp')}</span>
          <button class="rg-ext-btn" onClick={() => auth.signOut()}>{t('signOut')}</button>
        </div>
      ) : auth.flow ? (
        <>
          <p class="rg-ext-muted">{t('deviceHint')}</p>
          <div class="rg-ext-code" aria-live="polite">{auth.flow.userCode}</div>
          <div class="inline">
            <button class="rg-ext-btn primary" onClick={() => auth.openDevicePage(auth.flow!)}>{t('openDevicePage')}</button>
            <span class="rg-ext-muted">{t('deviceWaiting')}</span>
          </div>
        </>
      ) : s ? (
        <>
          <p class="rg-ext-muted">{t('optionsSignedOut')}</p>
          <div><button class="rg-ext-btn primary" onClick={() => auth.start()}>{t('signIn')}</button></div>
        </>
      ) : null}
    </section>
  );
}

function Token({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const [saved, setSaved] = useState('');
  const err = auth.error;
  // Read the DOM value, not state, so Enter and autofill always send what the field shows.
  const submit = async (input: HTMLInputElement) => {
    const token = input.value.trim();
    if (!token) return;
    setSaved('');
    const s = await auth.savePat(token);
    if (s) {
      input.value = '';
      setSaved(t('optionsTokenSaved', s.login ?? ''));
    }
  };
  return (
    <section aria-labelledby="h-token">
      <h2 id="h-token">{t('optionsTokenHeading')}</h2>
      <p>{t('optionsTokenIntro')}</p>
      <p class="rg-ext-muted">{t('optionsTokenKinds')}</p>
      <p class="rg-ext-muted">{t('optionsTokenPolicy')}</p>
      <form
        class="field"
        onSubmit={(e) => {
          e.preventDefault();
          void submit((e.currentTarget as HTMLFormElement).elements.namedItem('token') as HTMLInputElement);
        }}
      >
        <label for="rg-token">{t('optionsTokenLabel')}</label>
        <div class="inline">
          <input id="rg-token" name="token" class="rg-ext-input" type="password" autocomplete="off" spellcheck={false} />
          <button class="rg-ext-btn" type="submit">{t('optionsTokenSave')}</button>
        </div>
      </form>
      {err && <p class="rg-ext-err" role="alert">{err.message}{err.hint ? ` ${err.hint}` : ''}</p>}
      {saved && <p class="rg-ext-ok" role="status">{saved}</p>}
    </section>
  );
}

function Ai() {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [mode, setMode] = useState<'gemini' | 'custom'>('gemini');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    call<LlmStatus>({ type: 'llm:status' })
      .then((s) => {
        setStatus(s);
        if (s.mode) setMode(s.mode);
      })
      .catch((e) => setError(toInfo(e).message));
  }, []);
  const run = async (fn: () => Promise<string>) => {
    setMsg('');
    setError('');
    try {
      setMsg(await fn());
    } catch (e) {
      setError(toInfo(e).message);
    }
  };
  const submit = (form: HTMLFormElement) => {
    const field = (n: string) => ((form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '').trim();
    const config = { mode, apiKey: field('key'), baseUrl: field('endpoint'), model: field('model') };
    void run(async () => {
      // The provider's origin is an optional host permission; the browser only asks inside a click.
      const origin = llmOrigin({ mode, baseUrl: config.baseUrl });
      if (origin && !(await browser.permissions.request({ origins: [origin] }))) throw new Error(t('optionsAiDenied'));
      setStatus(await call<LlmStatus>({ type: 'llm:save', config }));
      (form.elements.namedItem('key') as HTMLInputElement).value = '';
      return t('optionsAiSaved');
    });
  };
  const configured = !!status?.configured;
  return (
    <section aria-labelledby="h-ai">
      <h2 id="h-ai">{t('optionsAiHeading')}</h2>
      <p>{t('optionsAiIntro')}</p>
      <p class="notice" role="note">{t('optionsAiPrivacy')}</p>
      <form
        class="field"
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget as HTMLFormElement);
        }}
      >
        <label class="rg-ext-check">
          <input type="radio" name="mode" checked={mode === 'gemini'} onChange={() => setMode('gemini')} />
          {t('optionsAiModeGemini')}
        </label>
        <label class="rg-ext-check">
          <input type="radio" name="mode" checked={mode === 'custom'} onChange={() => setMode('custom')} />
          {t('optionsAiModeCustom')}
        </label>
        {mode === 'custom' && (
          <>
            <label for="rg-ai-endpoint">{t('optionsAiEndpoint')}</label>
            <input id="rg-ai-endpoint" name="endpoint" class="rg-ext-input" type="url" placeholder="https://…/v1" defaultValue={status?.baseUrl ?? ''} spellcheck={false} />
            <label for="rg-ai-model">{t('optionsAiModel')}</label>
            <input id="rg-ai-model" name="model" class="rg-ext-input" type="text" defaultValue={status?.model ?? ''} spellcheck={false} />
          </>
        )}
        <label for="rg-ai-key">{t('optionsAiKeyLabel')}</label>
        <input id="rg-ai-key" name="key" class="rg-ext-input" type="password" autocomplete="off" spellcheck={false} placeholder={configured ? '••••••••' : ''} />
        <span class="rg-ext-muted">{configured ? t('optionsAiKeySaved') : mode === 'gemini' ? t('optionsAiKeyHint') : ''}</span>
        {mode === 'gemini' && (
          <a class="rg-ext-link" href={status?.keysUrl ?? GEMINI_KEYS_URL} target="_blank" rel="noreferrer noopener">{t('optionsAiGetKey')}</a>
        )}
        <div class="inline">
          <button class="rg-ext-btn primary" type="submit">{t('optionsAiSave')}</button>
          <button
            class="rg-ext-btn"
            type="button"
            disabled={!configured}
            onClick={() =>
              run(async () => {
                const r = await call<{ model: string }>({ type: 'llm:test' });
                setStatus(await call<LlmStatus>({ type: 'llm:status' }));
                return t('optionsAiTestOk', r.model);
              })
            }
          >
            {t('optionsAiTest')}
          </button>
          <button
            class="rg-ext-btn"
            type="button"
            disabled={!configured}
            onClick={() => run(async () => (setStatus(await call<LlmStatus>({ type: 'llm:clear' })), t('optionsAiRemoved')))}
          >
            {t('optionsAiRemove')}
          </button>
        </div>
        <label class="rg-ext-check" for="rg-ai-auto">
          <input
            id="rg-ai-auto"
            type="checkbox"
            checked={status?.auto !== false}
            disabled={!configured}
            onChange={(e) => {
              const auto = (e.currentTarget as HTMLInputElement).checked;
              void run(async () => (setStatus(await call<LlmStatus>({ type: 'llm:auto', auto })), t('optionsAiAutoSaved')));
            }}
          />
          {t('optionsAiAuto')}
        </label>
        <span class="rg-ext-muted">{t('optionsAiAutoHint')}</span>
      </form>
      {configured && status?.mode === 'gemini' && <p class="rg-ext-muted">{status.activeModel ? t('optionsAiStatus', status.activeModel) : t('optionsAiStatusPending')}</p>}
      {msg && <p class="rg-ext-ok" role="status">{msg}</p>}
      {error && <p class="rg-ext-err" role="alert">{error}</p>}
    </section>
  );
}

function Cache() {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    call<{ refreshMinutes: number }>({ type: 'settings:get' }).then((s) => setMinutes(s.refreshMinutes)).catch((e) => setError(toInfo(e).message));
  }, []);
  const run = async (fn: () => Promise<string>) => {
    setMsg('');
    setError('');
    try {
      setMsg(await fn());
    } catch (e) {
      setError(toInfo(e).message);
    }
  };
  return (
    <section aria-labelledby="h-cache">
      <h2 id="h-cache">{t('optionsCacheHeading')}</h2>
      <p class="rg-ext-muted">{t('optionsCacheIntro')}</p>
      <div class="field">
        <label for="rg-interval">{t('optionsIntervalLabel')}</label>
        <input
          id="rg-interval"
          class="rg-ext-input narrow"
          type="number"
          min={1}
          max={1440}
          step={1}
          value={minutes ?? ''}
          disabled={minutes === null}
          onChange={(e) => {
            const v = Number((e.currentTarget as HTMLInputElement).value);
            void run(async () => {
              const s = await call<{ refreshMinutes: number }>({ type: 'settings:set', settings: { refreshMinutes: v } });
              setMinutes(s.refreshMinutes);
              return t('optionsIntervalSaved');
            });
          }}
        />
        <span class="rg-ext-muted">{t('optionsIntervalHint')}</span>
      </div>
      <div>
        <button class="rg-ext-btn" onClick={() => run(async () => (await call({ type: 'cache:clear' }), t('optionsCacheCleared')))}>{t('optionsCacheClear')}</button>
      </div>
      {msg && <p class="rg-ext-ok" role="status">{msg}</p>}
      {error && <p class="rg-ext-err" role="alert">{error}</p>}
    </section>
  );
}

function OrgRow({ org }: { org: OrgEntry }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    call<Partial<OrgPrefs>>({ type: 'prefs:get', org: org.login }).then((p) => setOn(p.groupedByDefault !== false)).catch(() => setOn(true));
  }, [org.login]);
  const id = `rg-org-${org.login}`;
  return (
    <li>
      <div class="rg-ext-row">
        {org.avatarUrl && <img class="rg-ext-av" src={org.avatarUrl} alt="" />}
        <strong>{org.login}</strong>
        {!org.hasFile && <span class="rg-ext-muted">{t('optionsOrgNoFile')}</span>}
      </div>
      <label class="rg-ext-check" for={id}>
        <input
          id={id}
          type="checkbox"
          checked={on ?? true}
          disabled={on === null}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLInputElement).checked;
            setOn(v);
            call({ type: 'prefs:set', org: org.login, prefs: { groupedByDefault: v } }).catch(() => setOn(!v));
          }}
        />
        {t('optionsOrgGrouped')}
      </label>
    </li>
  );
}

function Orgs({ signedIn }: { signedIn: boolean | undefined }) {
  const [orgs, setOrgs] = useState<OrgEntry[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!signedIn) return setOrgs(null);
    let alive = true;
    call<OrgList>({ type: 'orgs:list' })
      .then((l) => alive && setOrgs(l.orgs))
      .catch((e) => {
        if (!alive) return;
        const i = toInfo(e);
        setOrgs([]);
        setError(t('optionsLoadError', i.message + (i.hint ? ` ${i.hint}` : '')));
      });
    return () => {
      alive = false;
    };
  }, [signedIn]);
  return (
    <section aria-labelledby="h-orgs">
      <h2 id="h-orgs">{t('optionsOrgsHeading')}</h2>
      <p class="rg-ext-muted">{t('optionsOrgGroupedHint')}</p>
      {signedIn === undefined ? null : !signedIn ? (
        <p class="rg-ext-muted">{t('optionsOrgsSignedOut')}</p>
      ) : orgs === null ? (
        <p class="rg-ext-muted" role="status">{t('optionsOrgsLoading')}</p>
      ) : orgs.length ? (
        <ul class="orgs">{orgs.map((o) => <OrgRow key={o.login} org={o} />)}</ul>
      ) : (
        !error && <p class="rg-ext-muted">{t('optionsOrgsEmpty')}</p>
      )}
      {error && <p class="rg-ext-err" role="alert">{error}</p>}
    </section>
  );
}

function ActionIndex() {
  return (
    <section aria-labelledby="h-action">
      <h2 id="h-action">{t('optionsActionHeading')}</h2>
      <p>{t('optionsActionBody')}</p>
      <p class="notice warn" role="note">{t('optionsActionWarning')}</p>
    </section>
  );
}

export function App() {
  const auth = useAuth();
  return (
    <main>
      <h1><img src="/icon/48.png" alt="" />{t('optionsTitle')}</h1>
      <Account auth={auth} />
      <Token auth={auth} />
      <Ai />
      <Cache />
      <Orgs signedIn={auth.status?.signedIn} />
      <ActionIndex />
      {/* My groups export / import (F13) is added here by its own milestone. */}
    </main>
  );
}
