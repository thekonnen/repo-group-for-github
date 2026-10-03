import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { t } from '../../i18n';
import { call } from '../../github/client';
import { groupedViewUrl, orgFromUrl } from '../../ext-pages/tab-org';
import { toInfo, useAuth } from '../../ext-pages/use-auth';
import type { OrgEntry, OrgList } from '../../background/orgs';

/**
 * Reads the URL of the active tab. For a github.com tab this works with the existing host permission
 * (https://github.com/*): no "tabs" or "activeTab" permission is needed. Any other tab simply has no url.
 */
async function activeTabUrl(): Promise<string | undefined> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab?.url;
  } catch {
    return undefined;
  }
}

export function App() {
  const auth = useAuth();
  const [orgs, setOrgs] = useState<OrgEntry[] | null>(null);
  const [tabUrl, setTabUrl] = useState<string | undefined>();
  const [orgError, setOrgError] = useState('');
  const signedIn = !!auth.status?.signedIn;

  useEffect(() => {
    activeTabUrl().then(setTabUrl);
  }, []);
  useEffect(() => {
    if (!signedIn) return setOrgs(null);
    let alive = true;
    call<OrgList>({ type: 'orgs:list' })
      .then((l) => alive && setOrgs(l.orgs))
      .catch((e) => alive && (setOrgs([]), setOrgError(toInfo(e).message)));
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const tabOrg = signedIn ? orgFromUrl(tabUrl, (l) => !!orgs?.some((o) => o.login.toLowerCase() === l.toLowerCase())) : null;
  const withFile = (orgs ?? []).filter((o) => o.hasFile);
  const open = (url: string) => browser.tabs.create({ url }).then(() => window.close());
  const err = auth.error;

  return (
    <main>
      <h1><img src="/icon/48.png" alt="" />Repository Group for Github</h1>
      {auth.status?.signedIn ? (
        <>
          <div class="rg-ext-row">
            {auth.status.avatarUrl && <img class="rg-ext-av" src={auth.status.avatarUrl} alt="" />}
            <span class="grow">{auth.status.login}</span>
            <span class="rg-ext-muted">{auth.status.kind === 'pat' ? t('accountKindToken') : t('accountKindApp')}</span>
            <button class="rg-ext-btn" onClick={() => auth.signOut()}>{t('signOut')}</button>
          </div>
          {tabOrg && (
            <button class="rg-ext-btn primary block" onClick={() => open(groupedViewUrl(tabOrg))}>{t('popupOpenGrouped', tabOrg)}</button>
          )}
          <h2>{t('popupOrgsHeading')}</h2>
          {orgs === null ? (
            <span class="rg-ext-muted" role="status">{t('popupOrgsLoading')}</span>
          ) : withFile.length ? (
            <ul class="orgs">
              {withFile.map((o) => (
                <li key={o.login}>
                  <a href={groupedViewUrl(o.login)} target="_blank" rel="noopener">
                    {o.avatarUrl && <img src={o.avatarUrl} alt="" />}
                    <span>{o.login}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <span class="rg-ext-muted">{t('popupOrgsEmpty')}</span>
          )}
          {orgError && <p class="rg-ext-err" role="alert">{orgError}</p>}
        </>
      ) : auth.flow ? (
        <>
          <span class="rg-ext-muted">{t('deviceHint')}</span>
          <div class="rg-ext-code" aria-live="polite">{auth.flow.userCode}</div>
          <button class="rg-ext-btn primary" onClick={() => auth.openDevicePage(auth.flow!)}>{t('openDevicePage')}</button>
          <span class="rg-ext-muted">{t('deviceWaiting')}</span>
        </>
      ) : auth.status ? (
        <>
          <span class="rg-ext-muted">{t('signInHint')}</span>
          <button class="rg-ext-btn primary" onClick={() => auth.start()}>{t('signIn')}</button>
        </>
      ) : null}
      {err && <p class="rg-ext-err" role="alert">{err.message}{err.hint ? ` ${err.hint}` : ''}</p>}
      <button class="rg-ext-link" style="justify-self:start" onClick={() => browser.runtime.openOptionsPage()}>{t('popupOptions')}</button>
    </main>
  );
}
