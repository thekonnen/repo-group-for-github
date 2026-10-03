import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  vite: () => ({ plugins: [preact()] }),
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    short_name: 'RG',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
    optional_host_permissions: ['https://*/*'],
    ...(browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: 'repo-group-for-github@thekonnen', strict_min_version: '128.0' } } }
      : {}),
  }),
});
