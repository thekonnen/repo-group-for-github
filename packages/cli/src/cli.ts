import { createClient, type FetchLike } from '../../../src/background/api';
import type { DiffResult } from '../../../src/core/diff';
import { CliError, type ChangeResult, type Ctx } from './service';
import * as svc from './service';

export interface CliDeps {
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  out: (s: string) => void;
  err: (s: string) => void;
  readFile: (path: string) => Promise<string>;
  readStdin: () => Promise<string>;
}

export const HELP = `rg - read and edit repo-groups.yml in <org>/.github

Usage: rg <command> [options]

Read:
  list-groups                     Group tree with repository counts
  list-repos [--ungrouped | --group <path>] [--limit N]
  show-group <path>               Rules, teams and repositories of one group
  suggest [--limit N]             Ungrouped repositories with a suggested group
  validate [file]                 Validate a file (or the one on GitHub)
  diff <file>                     What applying <file> would change ("-" reads stdin)

Write (dry-run by default; nothing is committed without --yes):
  move-repo <repo> <group>        List the repository by exact name in <group>
  add-rule <group> <rule>         Add a name or pattern (dags-*) to <group>
  create-group <path> [--description "..."]
  apply <file>                    Replace repo-groups.yml with <file> ("-" reads stdin)

  mcp                             Run the MCP server on stdio (tools mirror these commands)

Options:
  --org <org>      Organization (or RG_ORG)
  --yes            Commit to <org>/.github (write commands)
  --json           Machine-readable output
  --yaml           Also print the resulting YAML (write commands)
  -h, --help

Auth: set GITHUB_TOKEN to a fine-grained or classic personal access token (Contents read/write on <org>/.github).`;

const VALUE_FLAGS = new Set(['org', 'group', 'description', 'limit']);
const BOOL_FLAGS = new Set(['yes', 'json', 'yaml', 'ungrouped', 'help', 'h']);

export interface Parsed {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') flags.help = true;
    else if (a === '-' || !a.startsWith('--')) positionals.push(a);
    else {
      const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
      if (VALUE_FLAGS.has(k)) {
        const v = inline ?? argv[++i];
        if (v === undefined) throw new CliError(`--${k} needs a value.`);
        flags[k] = v;
      } else if (BOOL_FLAGS.has(k)) flags[k] = true;
      else throw new CliError(`Unknown option --${k}. Run rg --help.`);
    }
  }
  return { command: positionals.shift() ?? '', positionals, flags };
}

export const diffLines = (d: DiffResult): string[] => d.items.map((i) => (i.k === '→' ? `→ ${i.text}: ${i.to}` : `${i.k} ${i.text}${i.to ? `: ${i.to}` : ''}`));

function formatChange(r: ChangeResult, showYaml: boolean): string {
  const lines: string[] = [];
  if (r.noChange) lines.push('No changes: the file on GitHub already matches.');
  else if (r.applied) lines.push(`Committed to ${r.org}/.github/repo-groups.yml${r.commit ? ` (${r.commit.slice(0, 7)})` : ''}: ${r.message}`);
  else lines.push(`Dry run. Nothing was committed. Would commit "${r.message}" with:`);
  lines.push(...diffLines(r.diff).map((l) => '  ' + l));
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  if (r.dryRun && !r.noChange) lines.push('', 'Re-run with --yes to commit.');
  if (showYaml) lines.push('', r.yaml.trimEnd());
  return lines.join('\n');
}

const pad = (n: number | string, w: number) => String(n).padStart(w);

export function formatResult(command: string, data: any, showYaml = false): string {
  switch (command) {
    case 'list-groups': {
      const lines = [`${data.org}: ${data.repositories} repositories, ${data.ungrouped} ungrouped${data.fileExists ? '' : ' (no repo-groups.yml yet)'}`];
      for (const g of data.groups) lines.push(`${'  '.repeat(g.depth)}${g.path.split('/').pop()}  ${g.repos} repos${g.subgroups ? `, ${g.subgroups} subgroups` : ''}${g.rules.length ? `  [${g.rules.join(', ')}]` : ''}`);
      return lines.join('\n');
    }
    case 'list-repos':
      return [...data.repos.map((r: svc.RepoRow) => `${r.name}  ${r.group || '(ungrouped)'}${r.private ? '  private' : ''}`), `${data.repos.length} of ${data.total}`].join('\n');
    case 'show-group': {
      const lines = [`${data.path}${data.title ? ` (${data.title})` : ''}`];
      if (data.description) lines.push(data.description);
      lines.push(`rules: ${data.rules.join(', ') || '(none)'}`);
      if (data.keywords.length) lines.push(`keywords: ${data.keywords.join(', ')}`);
      if (data.teams.length) lines.push(`teams: ${data.teams.map((t: any) => `${t.slug}:${t.permission}`).join(', ')}`);
      lines.push(`subgroups: ${data.subgroups.join(', ') || '(none)'}`);
      lines.push(`repositories: ${data.reposTotal} total, ${data.reposDirect.length} directly here`);
      for (const n of data.reposDirect) lines.push(`  ${n}`);
      return lines.join('\n');
    }
    case 'suggest':
      return [
        `${data.ungrouped} ungrouped repositories`,
        ...data.suggestions.map((s: any) => `${s.name}  ->  ${s.suggested ?? '(not sure)'}  [${s.source}, ${pad(s.score, 5)}]${s.suggested ? '' : s.alternatives.length ? '  maybe: ' + s.alternatives.join(', ') : ''}`),
      ].join('\n');
    case 'validate': {
      const lines = [data.valid ? `Valid (${data.groups} groups${data.fencesRemoved ? ', code fences removed' : ''}).` : `Invalid: ${data.error}`];
      for (const w of data.warnings) lines.push(`warning: ${w}`);
      return lines.join('\n');
    }
    case 'diff':
      return [data.noChange ? 'No changes.' : `${data.diff.items.length} changes:`, ...diffLines(data.diff).map((l) => '  ' + l), ...data.warnings.map((w: string) => `warning: ${w}`)].join('\n');
    default:
      return formatChange(data, showYaml);
  }
}

export function makeCtx(env: CliDeps['env'], fetch: FetchLike, orgFlag?: string): Ctx {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new CliError('Set GITHUB_TOKEN to a GitHub personal access token.');
  const org = orgFlag || env.RG_ORG;
  if (!org) throw new CliError('Give the organization with --org or RG_ORG.');
  return { client: createClient({ fetch, getToken: async () => token }), org };
}

const need = (p: Parsed, n: number, usage: string) => {
  if (p.positionals.length < n) throw new CliError(`Usage: rg ${usage}`);
};
const int = (v: string | boolean | undefined): number | undefined => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);

/** Runs one command. Returns the process exit code. The token is never printed. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  try {
    const p = parseArgs(argv);
    if (!p.command || p.flags.help || p.command === 'help') {
      deps.out(HELP);
      return p.command || p.flags.help ? 0 : 1;
    }
    const readInput = async (path: string) => (path === '-' ? deps.readStdin() : deps.readFile(path));
    const json = !!p.flags.json;
    const ctx = () => makeCtx(deps.env, deps.fetch, p.flags.org as string | undefined);
    const apply = !!p.flags.yes;
    let data: any;
    let code = 0;
    switch (p.command) {
      case 'list-groups':
        data = await svc.listGroups(ctx());
        break;
      case 'list-repos':
        data = await svc.listRepos(ctx(), { ungrouped: !!p.flags.ungrouped, group: p.flags.group as string | undefined, limit: int(p.flags.limit) });
        break;
      case 'show-group':
        need(p, 1, 'show-group <path>');
        data = await svc.showGroup(ctx(), p.positionals[0]);
        break;
      case 'suggest':
        data = await svc.suggestRepos(ctx(), { limit: int(p.flags.limit) });
        break;
      case 'validate': {
        const text = p.positionals[0] ? await readInput(p.positionals[0]) : undefined;
        data = await svc.validate(ctx(), text);
        if (!data.valid) code = 1;
        break;
      }
      case 'diff':
        need(p, 1, 'diff <file>');
        data = await svc.diffYaml(ctx(), await readInput(p.positionals[0]));
        break;
      case 'move-repo':
        need(p, 2, 'move-repo <repo> <group>');
        data = await svc.runChange(ctx(), { kind: 'move-repo', repo: p.positionals[0], group: p.positionals[1] }, { apply });
        break;
      case 'add-rule':
        need(p, 2, 'add-rule <group> <rule>');
        data = await svc.runChange(ctx(), { kind: 'add-rule', group: p.positionals[0], rule: p.positionals[1] }, { apply });
        break;
      case 'create-group':
        need(p, 1, 'create-group <path> [--description "..."]');
        data = await svc.runChange(ctx(), { kind: 'create-group', path: p.positionals[0], description: p.flags.description as string | undefined }, { apply });
        break;
      case 'apply':
        need(p, 1, 'apply <file>');
        data = await svc.runChange(ctx(), { kind: 'apply-file', yaml: await readInput(p.positionals[0]) }, { apply });
        break;
      default:
        throw new CliError(`Unknown command "${p.command}". Run rg --help.`);
    }
    if (json) {
      const { yaml, ...rest } = data;
      deps.out(JSON.stringify(p.flags.yaml || !('yaml' in data) ? data : rest, null, 2));
    } else deps.out(formatResult(p.command, data, !!p.flags.yaml));
    return code;
  } catch (e) {
    deps.err(`rg: ${e instanceof Error ? e.message : String(e)}`);
    return e instanceof CliError ? 1 : 2;
  }
}
