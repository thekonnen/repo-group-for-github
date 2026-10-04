import { createClient, type FetchLike } from '../../../src/background/api';
import { CliError, type Ctx } from './service';
import * as svc from './service';

/**
 * Minimal MCP server over stdio: newline-delimited JSON-RPC 2.0 with initialize, tools/list, tools/call and ping.
 * No SDK. Write tools are dry-run unless the call passes `apply: true`.
 */

export interface McpDeps {
  env: Record<string, string | undefined>;
  fetch: FetchLike;
}

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const orgProp = { type: 'string', description: 'GitHub organization. Defaults to the RG_ORG environment variable.' };
const applyProp = { type: 'boolean', description: 'false (default): dry run, returns the diff and commits nothing. true: commit to <org>/.github/repo-groups.yml.' };
const yamlProp = { type: 'boolean', description: 'Also return the resulting YAML text.' };
const str = (description: string) => ({ type: 'string', description });

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: { org: orgProp, ...properties }, required, additionalProperties: false });

export const TOOLS = [
  { name: 'list_groups', description: 'Group tree of the organization with repository counts, rules and the number of ungrouped repositories.', inputSchema: obj({}) },
  {
    name: 'list_repos',
    description: 'Repositories the token can access, with the group each one lands in. Filter by group (recursive) or only ungrouped ones.',
    inputSchema: obj({ ungrouped: { type: 'boolean' }, group: str('Group path, for example infra/dagsrv'), limit: { type: 'integer', minimum: 1 } }),
  },
  { name: 'show_group', description: 'Details of one group: description, rules, teams, subgroups and repositories.', inputSchema: obj({ path: str('Group path, for example infra/dagsrv') }, ['path']) },
  {
    name: 'suggest',
    description: 'Ungrouped repositories with a suggested group (match rules, then a lexical score). source "uncertain" means no confident suggestion.',
    inputSchema: obj({ limit: { type: 'integer', minimum: 1 } }),
  },
  {
    name: 'move_repo',
    description: 'File a repository in a group by listing its exact name in that group match list (removing it from other groups exact lists). Dry run unless apply is true.',
    inputSchema: obj({ repo: str('Repository name'), group: str('Target group path'), apply: applyProp, include_yaml: yamlProp }, ['repo', 'group']),
  },
  {
    name: 'add_rule',
    description: 'Add a match rule (exact name or a pattern like dags-*) to a group. Dry run unless apply is true.',
    inputSchema: obj({ group: str('Group path'), rule: str('Repository name or pattern'), apply: applyProp, include_yaml: yamlProp }, ['group', 'rule']),
  },
  {
    name: 'create_group',
    description: 'Create a group or subgroup. The parent must exist. Dry run unless apply is true.',
    inputSchema: obj({ path: str('Full path, for example infra/dagsrv'), description: str('Group description'), apply: applyProp, include_yaml: yamlProp }, ['path']),
  },
  {
    name: 'validate',
    description: 'Validate repo-groups.yml text (code fences and the repositories: key are tolerated). Without yaml, validates the file on GitHub.',
    inputSchema: obj({ yaml: str('YAML text to validate') }),
  },
  { name: 'diff', description: 'Show what replacing repo-groups.yml with the given YAML would change. Never writes.', inputSchema: obj({ yaml: str('Proposed YAML text') }, ['yaml']) },
  {
    name: 'apply',
    description: 'Replace repo-groups.yml with the given YAML. Dry run (diff only) unless apply is true. Refuses when the file changed on GitHub since it was read.',
    inputSchema: obj({ yaml: str('Full proposed YAML text'), apply: applyProp, include_yaml: yamlProp }, ['yaml']),
  },
] as const;

type Args = Record<string, any>;
const reqStr = (a: Args, k: string): string => {
  if (typeof a[k] !== 'string' || !a[k].trim()) throw new CliError(`Argument "${k}" is required.`);
  return a[k];
};

/** Runs a tool and returns its JSON-serializable result. Throws CliError for problems the caller can fix. */
export async function callTool(name: string, a: Args, deps: McpDeps): Promise<unknown> {
  const token = deps.env.GITHUB_TOKEN;
  if (!token) throw new CliError('GITHUB_TOKEN is not set in the environment of this MCP server.');
  const org = typeof a.org === 'string' && a.org ? a.org : deps.env.RG_ORG;
  if (!org) throw new CliError('Give "org" or set RG_ORG in the environment of this MCP server.');
  const ctx: Ctx = { client: createClient({ fetch: deps.fetch, getToken: async () => token }), org };
  const apply = a.apply === true;
  const change = async (c: svc.Change) => {
    const { yaml, ...rest } = await svc.runChange(ctx, c, { apply });
    return a.include_yaml === true ? { ...rest, yaml } : rest;
  };
  switch (name) {
    case 'list_groups':
      return svc.listGroups(ctx);
    case 'list_repos':
      return svc.listRepos(ctx, { ungrouped: a.ungrouped === true, group: typeof a.group === 'string' ? a.group : undefined, limit: typeof a.limit === 'number' ? a.limit : undefined });
    case 'show_group':
      return svc.showGroup(ctx, reqStr(a, 'path'));
    case 'suggest':
      return svc.suggestRepos(ctx, { limit: typeof a.limit === 'number' ? a.limit : undefined });
    case 'move_repo':
      return change({ kind: 'move-repo', repo: reqStr(a, 'repo'), group: reqStr(a, 'group') });
    case 'add_rule':
      return change({ kind: 'add-rule', group: reqStr(a, 'group'), rule: reqStr(a, 'rule') });
    case 'create_group':
      return change({ kind: 'create-group', path: reqStr(a, 'path'), description: typeof a.description === 'string' ? a.description : undefined });
    case 'validate':
      return svc.validate(ctx, typeof a.yaml === 'string' ? a.yaml : undefined);
    case 'diff':
      return svc.diffYaml(ctx, reqStr(a, 'yaml'));
    case 'apply':
      return change({ kind: 'apply-file', yaml: reqStr(a, 'yaml') });
    default:
      throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

interface Req {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

/** Handles one JSON-RPC message. Returns the response, or undefined for notifications. */
export async function handleMessage(msg: Req, deps: McpDeps): Promise<object | undefined> {
  const isNotification = msg.id === undefined || msg.id === null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (typeof msg.method !== 'string') return isNotification ? undefined : fail(-32600, 'Invalid request');
  try {
    switch (msg.method) {
      case 'initialize': {
        const want = msg.params?.protocolVersion;
        return ok({
          protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'repo-groups', version: '0.1.0' },
          instructions: 'Read and edit repo-groups.yml of a GitHub organization. Write tools are dry-run unless apply is true.',
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: TOOLS });
      case 'tools/call': {
        const name = msg.params?.name;
        if (typeof name !== 'string' || !TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
        try {
          const result = await callTool(name, msg.params?.arguments ?? {}, deps);
          return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (e) {
          if (e instanceof RpcError) throw e;
          const text = e instanceof Error ? e.message : String(e);
          return ok({ content: [{ type: 'text', text }], isError: true });
        }
      }
      default:
        return isNotification ? undefined : fail(-32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    if (isNotification) return undefined;
    return e instanceof RpcError ? fail(e.code, e.message) : fail(-32603, e instanceof Error ? e.message : 'Internal error');
  }
}

/** Reads newline-delimited JSON-RPC from `input` and writes responses with `write`. Resolves when input ends. */
export async function serveStdio(input: AsyncIterable<string | Buffer>, write: (line: string) => void, deps: McpDeps): Promise<void> {
  let buf = '';
  const pending: Promise<void>[] = [];
  const one = async (line: string) => {
    if (!line.trim()) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      return;
    }
    const res = await handleMessage(msg, deps);
    if (res) write(JSON.stringify(res));
  };
  for await (const chunk of input) {
    buf += chunk.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      pending.push(one(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  }
  if (buf.trim()) pending.push(one(buf));
  await Promise.all(pending);
}
