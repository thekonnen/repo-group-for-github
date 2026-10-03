import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
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
      <Cache />
      <Orgs signedIn={auth.status?.signedIn} />
      <ActionIndex />
      {/* My groups export / import (F13) is added here by its own milestone. */}
    </main>
  );
}
