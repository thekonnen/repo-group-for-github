import { run } from './reorg-run';

const env = process.env;
const token = env.REPO_GROUPS_TOKEN || env.GITHUB_TOKEN;
const org = env.ORG || env.GITHUB_REPOSITORY_OWNER;
if (!token || !org) {
  console.error('Set REPO_GROUPS_TOKEN and ORG (or run inside GitHub Actions).');
  process.exit(1);
}
run({ org, token, repo: env.CONFIG_REPO || '.github', dryRun: /^(1|true|yes)$/i.test(env.DRY_RUN || '') }).catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
