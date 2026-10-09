# Creating the GitHub App

The extension signs users in with a GitHub App and the **device flow**. Create the App once, then put its client id and slug in `src/config.ts`.

## 1. Open the pre-filled form

The App can be installed on any personal account or organization once you select **Any account** (step 3).

- Personal account: https://github.com/settings/apps/new?name=Repository+Group+for+Github&description=Organizes+the+repositories+of+a+GitHub+organization+into+groups+and+subgroups.+No+server%3A+data+stays+in+GitHub+and+in+your+browser.&url=https%3A%2F%2Fgithub.com%2Fthekonnen%2Frepo-group-for-github&public=true&webhook_active=false&metadata=read&contents=write&issues=write&pull_requests=read&administration=write&members=read&organization_custom_properties=read
- Organization `thekonnen`: https://github.com/organizations/thekonnen/settings/apps/new?name=Repository+Group+for+Github&description=Organizes+the+repositories+of+a+GitHub+organization+into+groups+and+subgroups.+No+server%3A+data+stays+in+GitHub+and+in+your+browser.&url=https%3A%2F%2Fgithub.com%2Fthekonnen%2Frepo-group-for-github&public=true&webhook_active=false&metadata=read&contents=write&issues=write&pull_requests=read&administration=write&members=read&organization_custom_properties=read
- Any other org: `node scripts/app-link.mjs <org>`

The links preselect the name, homepage, no webhook, and the permissions below. They cannot set the install scope or the two device-flow options. GitHub lets you edit everything before you click **Create**. The name must be unique across GitHub; if it is taken, change it (and the slug in `src/config.ts` follows it).

## 2. Check the permissions on the form

| Scope | Permission | Level |
|---|---|---|
| Repository | Metadata | Read |
| Repository | Contents | Read & write (only used on `<org>/.github`) |
| Repository | Issues | Read & write (open counts; adds default labels and milestones, Sync labels) |
| Repository | Pull requests | Read |
| Repository | Administration | Read & write (only to add teams to repositories) |
| Organization | Members | Read |
| Organization | Custom properties | Read (only for `prop:` rules; without it they match nothing) |

If a permission is not preselected, set it by hand. Administration (write) is the sensitive one (CLAUDE.md §6).

## 3. Settings the link cannot set

On the same form:

1. Check **Enable Device Flow**.
2. Uncheck **Expire user authorization tokens** (checked by default; no client secret is needed for refresh).
3. At the bottom, *Where can this GitHub App be installed?* → **Any account**. The default, "Only on this account", prevents installing it on an org.

For an existing App, also check **Expire user authorization tokens** in its settings. The extension keeps the authorization in browser local storage across restarts and does not sign out automatically, but it cannot extend a token that GitHub expires or revokes. Without a client secret, an expired authorization requires signing in again. Clearing extension storage, reinstalling the extension, or signing out also removes the saved authorization.

Leave the callback URL empty and **Webhook → Active** unchecked.

## 4. After creating

1. Copy the **Client ID** into `GITHUB_CLIENT_ID` and the slug (the last part of `github.com/apps/<slug>`) into `APP_SLUG` in `src/config.ts`. The client id is not a secret. Do **not** generate a client secret or a private key.
2. **Install App** on each account or org, with **All repositories**. Direct link (no Marketplace checkout, no billing data): `https://github.com/apps/konnen-repository-group-for-github/installations/new`. A user token only reaches what both the App and the user can reach, so this is required (F15).
3. Changing permissions later needs an org owner to accept the update at `https://github.com/organizations/<org>/settings/installations`. This applies to **Custom properties: Read** on an App that was created before it was added: until an owner accepts it, `prop:` rules match nothing and the Match rules tab says so.
