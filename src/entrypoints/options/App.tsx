import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { t } from '../../i18n';
import { ANTHROPIC_DEFAULT_MODEL, GEMINI_KEYS_URL, llmOrigin, type LlmStatus, type Provider } from '../../background/llm';
import { call } from '../../github/client';
import { toInfo, useAuth } from '../../ext-pages/use-auth';
import type { OrgEntry, OrgList } from '../../background/orgs';
import type { OrgPrefs } from '../../github/messages';
import { DeviceCode } from '../../ui/DeviceCode';

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
          <DeviceCode code={auth.flow.userCode} className="rg-ext-code" />
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
  const viaApp = !!auth.status?.signedIn && auth.status.kind !== 'pat';
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
      {viaApp && <p class="notice" role="status">{t('optionsTokenNotNeeded')}</p>}
      <details open={!viaApp}>
        <summary>
          <h2 id="h-token">{t('optionsTokenHeading')}</h2>
        </summary>
        <div class="details-body">
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
        </div>
      </details>
    </section>
  );
}

const PROVIDERS = ['gemini', 'anthropic', 'custom'] as const;
const providerName = (p: Provider) => (p === 'gemini' ? t('optionsAiModeGemini') : p === 'anthropic' ? t('optionsAiModeAnthropic') : t('optionsAiModeCustom'));

function Ai() {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  // `mode` is the provider the form edits and, once saved, the one tried first.
  const [mode, setMode] = useState<Provider>('gemini');
  // Kept in state, not in the DOM, so switching the radio never loses what was typed or saved for the other provider.
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [aModel, setAModel] = useState('');
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const load = (s: LlmStatus, first = false) => {
    setStatus(s);
    if (first && s.mode) setMode(s.mode);
    setEndpoint((v) => (first || !v ? s.custom?.baseUrl ?? '' : v));
    setModel((v) => (first || !v ? s.custom?.model ?? '' : v));
    setAModel((v) => (first || !v ? s.anthropic?.model ?? '' : v));
  };
  useEffect(() => {
    call<LlmStatus>({ type: 'llm:status' }).then((s) => load(s, true)).catch((e) => setError(toInfo(e).message));
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
  const save = () =>
    run(async () => {
      // The provider's origin is an optional host permission; the browser only asks inside a click.
      const origin = llmOrigin({ mode, baseUrl: endpoint.trim() || status?.custom?.baseUrl });
      if (origin && !(await browser.permissions.request({ origins: [origin] }))) throw new Error(t('optionsAiDenied'));
      load(await call<LlmStatus>({ type: 'llm:save', config: { mode, apiKey: key, baseUrl: endpoint, model: mode === 'anthropic' ? aModel : model } }));
      setKey('');
      return t('optionsAiSaved');
    });
  const saved = (p: Provider) => !!status?.[p]?.configured;
  const both = saved('gemini') && saved('custom');
  const configured = !!status?.configured;
  const keyHint = saved(mode) ? t('optionsAiKeySavedFor') : mode === 'gemini' ? t('optionsAiKeyHint') : mode === 'anthropic' ? '' : t('optionsAiKeyMissingCustom');
  const first = status?.mode;
  const second = first ? PROVIDERS.find((p) => p !== first && saved(p)) : undefined;
  return (
    <section aria-labelledby="h-ai">
      <h2 id="h-ai">{t('optionsAiHeading')}</h2>
      <p>{t('optionsAiIntro')}</p>
      <p class="notice" role="note">{t('optionsAiPrivacy')}</p>
      <form
        class="field"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {PROVIDERS.map((p) => (
          <label class="rg-ext-check" key={p}>
            <input type="radio" name="mode" checked={mode === p} onChange={() => setMode(p)} />
            {providerName(p)}
            <span class="rg-ext-muted">
              {' '}
              · {saved(p) ? (first === p ? `${t('optionsAiTagSaved')}, ${t('optionsAiTagPrimary')}` : t('optionsAiTagSaved')) : t('optionsAiTagNone')}
            </span>
          </label>
        ))}
        {mode === 'custom' && (
          <>
            <label for="rg-ai-endpoint">{t('optionsAiEndpoint')}</label>
            <input id="rg-ai-endpoint" name="endpoint" class="rg-ext-input" type="url" placeholder="https://…/v1" value={endpoint} onInput={(e) => setEndpoint((e.currentTarget as HTMLInputElement).value)} spellcheck={false} />
            <label for="rg-ai-model">{t('optionsAiModel')}</label>
            <input id="rg-ai-model" name="model" class="rg-ext-input" type="text" value={model} onInput={(e) => setModel((e.currentTarget as HTMLInputElement).value)} spellcheck={false} />
          </>
        )}
        {mode === 'anthropic' && (
          <>
            <label for="rg-ai-amodel">{t('optionsAiModel')}</label>
            <input id="rg-ai-amodel" name="amodel" class="rg-ext-input" type="text" placeholder={ANTHROPIC_DEFAULT_MODEL} value={aModel} onInput={(e) => setAModel((e.currentTarget as HTMLInputElement).value)} spellcheck={false} />
          </>
        )}
        <label for="rg-ai-key">{t('optionsAiKeyLabel')}</label>
        <input id="rg-ai-key" name="key" class="rg-ext-input" type="password" autocomplete="off" spellcheck={false} placeholder={saved(mode) ? '••••••••' : ''} value={key} onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)} />
        <span class="rg-ext-muted">{keyHint}</span>
        {mode === 'gemini' && (
          <a class="rg-ext-link" href={status?.keysUrl ?? GEMINI_KEYS_URL} target="_blank" rel="noreferrer noopener">{t('optionsAiGetKey')}</a>
        )}
        <div class="inline">
          <button class="rg-ext-btn primary" type="submit">{t('optionsAiSave')}</button>
          <button
            class="rg-ext-btn"
            type="button"
            disabled={!saved(mode)}
            onClick={() =>
              run(async () => {
                const r = await call<{ model: string }>({ type: 'llm:test', mode });
                load(await call<LlmStatus>({ type: 'llm:status' }));
                return t('optionsAiTestOkFor', providerName(mode), r.model);
              })
            }
          >
            {t('optionsAiTest')}
          </button>
          <button
            class="rg-ext-btn"
            type="button"
            disabled={!saved(mode)}
            onClick={() => run(async () => (load(await call<LlmStatus>({ type: 'llm:clear', mode })), t('optionsAiRemovedFor', providerName(mode))))}
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
              void run(async () => (load(await call<LlmStatus>({ type: 'llm:auto', auto })), t('optionsAiAutoSaved')));
            }}
          />
          {t('optionsAiAuto')}
        </label>
        <span class="rg-ext-muted">{t('optionsAiAutoHint')}</span>
        <label class="rg-ext-check" for="rg-ai-fallback">
          <input
            id="rg-ai-fallback"
            type="checkbox"
            checked={status?.fallback !== false}
            disabled={!both}
            onChange={(e) => {
              const fallback = (e.currentTarget as HTMLInputElement).checked;
              void run(async () => (load(await call<LlmStatus>({ type: 'llm:fallback', fallback })), t('optionsAiAutoSaved')));
            }}
          />
          {t('optionsAiFallback')}
        </label>
        <span class="rg-ext-muted">{both ? t('optionsAiFallbackHint') : t('optionsAiFallbackNeedsBoth')}</span>
        <label class="rg-ext-check" for="rg-ai-search">
          <input
            id="rg-ai-search"
            type="checkbox"
            checked={status?.search !== false}
            disabled={!configured}
            onChange={(e) => {
              const search = (e.currentTarget as HTMLInputElement).checked;
              void run(async () => (load(await call<LlmStatus>({ type: 'llm:search', search })), t('optionsAiAutoSaved')));
            }}
          />
          {t('optionsAiSearch')}
        </label>
        <span class="rg-ext-muted">{t('optionsAiSearchHint')}</span>
      </form>
      {first && (
        <p class="rg-ext-muted" id="rg-ai-order">
          {both && status?.fallback !== false && second ? t('optionsAiOrder', providerName(first), providerName(second)) : t('optionsAiOnly', providerName(first))}
          {status?.activeModel && saved('gemini') ? ` ${t('optionsAiStatus', status.activeModel)}` : ''}
        </p>
      )}
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
