import { displayName } from './edit';
import type { GroupNode } from './tree';
import type { RepoInfo } from './types';

/** Default size cap of a context pack, in characters. */
export const CONTEXT_MAX_CHARS = 8000;
const README_MAX = 1500;
const LIST_MAX = 30; // rules, subgroups, teams listed by name
const SNIPPET_SIBLINGS = 20;

/** What the pack knows about a repo. `topics` is optional: the index does not carry them everywhere. */
export type ContextRepo = RepoInfo & { topics?: string[] };

export interface ContextInput {
  org: string;
  /** The group (or the virtual root) to describe. Its subgroups are included. */
  node: GroupNode;
  /** 'my' labels the source as the personal layer. Default 'org'. */
  layer?: 'org' | 'my';
  /** Team slugs of the group (own + inherited). Names only. */
  teams?: string[];
  /** README text of the group, when the group has one. */
  readme?: string;
  /** Topics per repo name, when known. */
  topics?: Record<string, string[]>;
  maxChars?: number;
}

export interface ContextResult {
  text: string;
  /** Repositories in the group (subgroups included). */
  total: number;
  /** Repositories left out to respect the size cap. */
  omitted: number;
  truncated: boolean;
}

/** One line of plain text, with the characters Markdown would act on escaped. */
export function mdText(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]<>|~&]/g, (c) => '\\' + c);
}

/** Inline code that survives backticks inside the text. */
export function codeSpan(s: string): string {
  const text = s.replace(/\s+/g, ' ').trim();
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + '…' : s);
const day = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : 'unknown');
const urlPart = (s: string) => encodeURIComponent(s);
const repoUrl = (org: string, name: string) => `https://github.com/${urlPart(org)}/${urlPart(name)}`;
const cloneUrl = (org: string, name: string) => `${repoUrl(org, name)}.git`;
const pathText = (node: GroupNode) => (node.path.length ? node.path.join('/') : '(top level)');
const list = (items: string[], fmt: (s: string) => string) => {
  const shown = items.slice(0, LIST_MAX).map(fmt).join(', ');
  return items.length > LIST_MAX ? `${shown}, and ${items.length - LIST_MAX} more` : shown;
};

interface Entry { node: GroupNode; repos: ContextRepo[] }

/** Every group of the subtree, parent before children, in file order, with the repos placed directly in it. */
function entries(node: GroupNode, topics: Record<string, string[]> | undefined): Entry[] {
  const out: Entry[] = [];
  const walk = (n: GroupNode) => {
    out.push({ node: n, repos: n.repos.map((r) => ({ ...r, topics: topics?.[r.name] ?? (r as ContextRepo).topics })) });
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

function repoLine(org: string, r: ContextRepo): string {
  const bits = [
    r.language ? mdText(r.language) : 'language unknown',
    `pushed ${day(r.pushedAt)}`,
    r.private === undefined ? 'visibility unknown' : r.private ? 'private' : 'public',
  ];
  if (r.fork) bits.push('fork');
  const desc = r.description?.trim() ? mdText(cut(r.description.replace(/\s+/g, ' ').trim(), 160)) : '_no description_';
  return `- [${mdText(r.name)}](${repoUrl(org, r.name)}) — ${desc}\n  ${bits.join(' · ')} · clone ${codeSpan(cloneUrl(org, r.name))}`;
}

/** Only what the data says. Anything else is marked unknown, never guessed. */
function relateSection(es: Entry[], all: ContextRepo[]): string {
  const lines: string[] = ['## How these repositories relate', ''];
  if (!all.length) {
    lines.push('- No repositories to compare. Relationships: **unknown**.');
  } else {
    const filed = es.filter((e) => e.repos.length);
    lines.push(`- Filed together by people: ${all.length} ${all.length === 1 ? 'repository' : 'repositories'} in ${filed.length} ${filed.length === 1 ? 'group' : 'groups'}. That filing is the only relationship recorded.`);
    for (const e of es) {
      if (e !== es[0] && e.node.group.description.trim()) lines.push(`- Group ${codeSpan(pathText(e.node))}: ${mdText(cut(e.node.group.description, 200))}`);
    }
    const langs = new Map<string, number>();
    for (const r of all) if (r.language) langs.set(r.language, (langs.get(r.language) ?? 0) + 1);
    if (langs.size) {
      const top = [...langs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
      lines.push(`- Languages (primary, from the index): ${top.map(([l, n]) => `${mdText(l)} ${n}`).join(', ')}.`);
    }
    const tc = new Map<string, number>();
    const withTopics = all.filter((r) => r.topics?.length);
    for (const r of withTopics) for (const t of new Set(r.topics)) tc.set(t, (tc.get(t) ?? 0) + 1);
    const shared = [...tc].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
    if (!withTopics.length) lines.push('- Topics: **unknown** (not available for these repositories).');
    else if (shared.length) lines.push(`- Topics shared by two or more repositories: ${shared.map(([t, n]) => `${mdText(t)} (${n})`).join(', ')}.`);
    else lines.push('- Topics: no topic is shared by two repositories.');
    lines.push('- Dependencies, shared APIs and deploy order: **unknown**. They are not recorded here. Read each repository before assuming a link.');
  }
  return lines.join('\n');
}

/**
 * Markdown "context pack" of a group for an AI coding agent. Pure and deterministic: the same input gives the same text.
 * Built only from the group definition and the repositories in the caller's own index; no network.
 */
export function buildGroupContext(input: ContextInput): ContextResult {
  const { org, node } = input;
  const max = Math.max(400, input.maxChars ?? CONTEXT_MAX_CHARS);
  const es = entries(node, input.topics);
  const all = es.flatMap((e) => e.repos);
  const total = all.length;
  const g = node.group;
  const isRoot = !node.path.length;
  const title = isRoot ? 'All groups' : node.path.map((p, i) => (i === node.path.length - 1 ? displayName(g) : p)).join(' / ');

  const head: string[] = [`# Context: ${mdText(org)} / ${mdText(title)}`, ''];
  head.push(`> Generated by Repository Group for Github from ${input.layer === 'my' ? 'the personal layer (My groups)' : `\`${org}/.github/repo-groups.yml\``}. It lists only repositories visible to the person who generated it. Treat it as a map, not as ground truth.`, '');
  head.push('## About this group', '');
  head.push(`- Path: ${codeSpan(pathText(node))}`);
  head.push(`- Description: ${g.description.trim() ? mdText(g.description) : '_none_'}`);
  const rules = g.match;
  head.push(`- Match rules: ${rules.length ? list(rules, codeSpan) : '_none (repositories are placed by subgroups or by name)_'}`);
  const teams = input.teams ?? [];
  head.push(`- Teams: ${teams.length ? list(teams, codeSpan) : '_none tagged_'}`);
  if (node.children.length) head.push(`- Subgroups: ${list(node.children.map((c) => c.key), codeSpan)}`);
  head.push(`- Repositories: ${total} (subgroups included)`);
  const readme = input.readme?.trim();
  if (readme) {
    head.push('', '### README of the group', '');
    head.push(...cut(readme, README_MAX).split(/\r?\n/).map((l) => '> ' + mdText(l)));
  }
  head.push('');
  const relate = relateSection(es, all);

  const fixed = head.join('\n') + '\n' + relate + '\n';
  const repoHeader = `\n## Repositories (${total})\n\n`;
  const note = (shown: number) =>
    shown < total
      ? `\n> Truncated: ${total - shown} of ${total} repositories omitted to stay within ${max.toLocaleString('en-US')} characters. The omitted ones are the last in the order above.\n`
      : '';

  // Repo lines in tree order; stop before the cap, keeping room for the truncation note.
  const blocks: string[] = [];
  let used = fixed.length + repoHeader.length + 240; // 240: worst-case truncation note
  let shown = 0;
  let full = false;
  for (const e of es) {
    if (!e.repos.length) continue;
    const heading = `### ${mdText(pathText(e.node))}\n\n`;
    let block = '';
    for (const r of e.repos) {
      const line = repoLine(org, r) + '\n';
      const cost = line.length + (block ? 0 : heading.length + 1);
      if (full || used + cost > max) { full = true; continue; }
      block += (block ? '' : heading) + line;
      used += cost;
      shown++;
    }
    if (block) blocks.push(block);
  }
  const repoSection = total ? repoHeader + blocks.join('\n') : `\n## Repositories (0)\n\nNo repositories in this group yet.\n`;
  let text = fixed + repoSection + note(shown);
  let truncated = shown < total;
  if (text.length > max) {
    // The group notes alone exceed the cap (very long text): hard cut with a marker.
    text = text.slice(0, max - 60).trimEnd() + `\n\n> Truncated to ${max.toLocaleString('en-US')} characters.\n`;
    truncated = true;
  }
  return { text, total, omitted: total - shown, truncated };
}

/** A short block to paste into a repo's AGENTS.md or CLAUDE.md. Siblings are the repos of the group, minus `repo` when given. */
export function buildAgentsSnippet(input: { org: string; node: GroupNode; repo?: string; layer?: 'org' | 'my' }): string {
  const { org, node, repo } = input;
  const siblings = entries(node, undefined).flatMap((e) => e.repos.map((r) => r.name)).filter((n) => n !== repo);
  const where = node.path.length ? `${org} / ${node.path.join(' / ')}` : org;
  const lines = [
    '## Repository group',
    '',
    `${repo ? `${codeSpan(repo)} belongs` : 'This repository belongs'} to the group ${codeSpan(where)}${input.layer === 'my' ? ' (a personal grouping, not shared with the organization)' : ''}.`,
  ];
  if (node.group.description.trim()) lines.push('', `Group description: ${mdText(cut(node.group.description, 200))}`);
  if (siblings.length) {
    const shown = siblings.slice(0, SNIPPET_SIBLINGS).map((n) => `[${mdText(n)}](${repoUrl(org, n)})`).join(', ');
    lines.push('', `Sibling repositories: ${shown}${siblings.length > SNIPPET_SIBLINGS ? `, and ${siblings.length - SNIPPET_SIBLINGS} more` : ''}.`);
  } else lines.push('', 'Sibling repositories: none known.');
  lines.push('', 'How they depend on each other is not recorded. Check a sibling before changing anything shared with it.');
  return lines.join('\n') + '\n';
}

/** `<org>-<group-path-dashes>-context.md`; the top level is named "all". */
export function contextFilename(org: string, path: string[]): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe(org)}-${path.length ? path.map(safe).join('-') : 'all'}-context.md`;
}
