import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { t } from '../../i18n';
import { call } from '../../github/client';
import { groupedViewUrl, orgFromUrl, userReposUrl } from '../../ext-pages/tab-org';
import { toInfo, useAuth } from '../../ext-pages/use-auth';
import type { OrgEntry, OrgList } from '../../background/orgs';
import { DeviceCode } from '../../ui/DeviceCode';

export function App() {
  const auth = useAuth();
  const [orgs, setOrgs] = useState<OrgEntry[] | null>(null);
  const [orgError, setOrgError] = useState('');
  const [tabOrg, setTabOrg] = useState<string | null>(null);

  // The org of the current tab is shown even when the API does not list it (e.g. a token without membership scope).
  useEffect(() => {
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => setTabOrg(orgFromUrl(tabs[0]?.url, () => false)))
      .catch(() => {});
  }, []);
  const signedIn = !!auth.status?.signedIn;

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

  const err = auth.error;

  return (
    <main>
      <h1><img src="/icon/48.png" alt="" />Konnen: Repo Group for Github</h1>
      {auth.status?.signedIn ? (
        <>
          <div class="rg-ext-row">
            {auth.status.avatarUrl && <img class="rg-ext-av" src={auth.status.avatarUrl} alt="" />}
            <span class="grow">{auth.status.login}</span>
            <span class="rg-ext-muted">{auth.status.kind === 'pat' ? t('accountKindToken') : t('accountKindApp')}</span>
            <button class="rg-ext-btn" onClick={() => auth.signOut()}>{t('signOut')}</button>
          </div>
          <h2>{t('popupAccountsHeading')}</h2>
          <span class="rg-ext-muted hint">{t('popupAccountsHint')}</span>
          <ul class="orgs">
            {auth.status.login && (
              <li>
                <a href={userReposUrl(auth.status.login)} target="_blank" rel="noopener" title={t('popupOpenRepos')}>
                  {auth.status.avatarUrl && <img src={auth.status.avatarUrl} alt="" />}
                  <span class="who">
                    <b>{auth.status.login}</b>
                    <small>{t('popupPersonal')}</small>
                  </span>
                  <span class="go" aria-hidden="true">↗</span>
                </a>
              </li>
            )}
            {orgs === null ? (
              <li class="rg-ext-muted" role="status">{t('popupOrgsLoading')}</li>
            ) : (
              withTab(orgs, tabOrg).map((o) => (
                <li key={o.login}>
                  <a href={groupedViewUrl(o.login)} target="_blank" rel="noopener" title={t('popupOpenRepos')}>
                    {o.avatarUrl && <img src={o.avatarUrl} alt="" />}
                    <span class="who">
                      <b>{o.login}</b>
                      <small>{o.hasFile ? t('popupOrgWithGroups') : t('popupOrg')}</small>
                    </span>
                    <span class="go" aria-hidden="true">↗</span>
                  </a>
                </li>
              ))
            )}
          </ul>
          {orgError && <p class="rg-ext-err" role="alert">{orgError}</p>}
        </>
      ) : auth.flow ? (
        <>
          <span class="rg-ext-muted">{t('deviceHint')}</span>
          <DeviceCode code={auth.flow.userCode} className="rg-ext-code" />
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

function withTab(orgs: OrgEntry[], tabOrg: string | null): OrgEntry[] {
  if (!tabOrg || orgs.some((o) => o.login.toLowerCase() === tabOrg.toLowerCase())) return orgs;
  return [{ login: tabOrg, avatarUrl: `https://github.com/${encodeURIComponent(tabOrg)}.png?size=64`, hasFile: false }, ...orgs];
}
