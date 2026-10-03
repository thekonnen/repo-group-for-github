import { describe, expect, it } from 'vitest';
import { appRegistrationUrl, APP_PERMISSIONS } from '../src/core/app-link';

describe('app registration link', () => {
  it('targets the personal account by default', () => {
    const u = new URL(appRegistrationUrl());
    expect(u.origin + u.pathname).toBe('https://github.com/settings/apps/new');
  });
  it('targets an organization', () => {
    const u = new URL(appRegistrationUrl({ org: 'thekonnen' }));
    expect(u.pathname).toBe('/organizations/thekonnen/settings/apps/new');
  });
  it('preselects exactly the §6 permissions and no webhook', () => {
    const u = new URL(appRegistrationUrl());
    for (const [k, v] of Object.entries(APP_PERMISSIONS)) expect(u.searchParams.get(k)).toBe(v);
    expect(u.searchParams.get('administration')).toBe('write');
    expect(u.searchParams.get('members')).toBe('read');
    expect(u.searchParams.get('webhook_active')).toBe('false');
  });
});
