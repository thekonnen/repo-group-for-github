import { postOrder, pickIn, ruleFor, type Node } from './placement';
import type { Group } from './types';

/**
 * Suggests a group for a repository that no rule catches. No network, no model: rules first (the same placement as
 * §5.3), then a small lexical score (tf-idf over group text and over the repos already listed in `match`), then a
 * confidence check. When it is not sure it says so, and the caller may ask an LLM (background/llm.ts).
 */

export interface Candidate {
  key: string;
  score: number;
}

export interface Suggestion {
  /** rule: placed by match rules. lexical: confident score. uncertain: the caller decides (LLM or ungrouped). */
  source: 'rule' | 'lexical' | 'uncertain';
  /** Group key ("infra/cloud"), or null when uncertain. */
  key: string | null;
  rule?: string;
  score: number;
  /** Best score minus the runner-up. */
  margin: number;
  ranking: Candidate[];
}

/** Calibrated on tests/fixtures/acme-groups.yml; below either value the answer is "uncertain". */
export const THRESHOLDS = { minScore: 0.2, minMargin: 0.1 };

const W_TEXT = 0.6; // title + description + keywords
const W_EXAMPLES = 0.4; // names already listed in `match` (the kNN idea, over words)

const STOP = new Set(
  'a an and as at by com da das de do dos e em for in is na nas no nos o os of on or para por the to um uma with app apps new old my repo repos repository projeto projetos servico servicos service services'.split(' '),
);

const deaccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

const rawTokens = (text: string): string[] =>
  deaccent(text.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

export const tokens = (text: string): string[] => rawTokens(text).map(stem);

type Vec = Map<string, number>;

function vec(words: string[], idf: Map<string, number>): Vec {
  const tf = new Map<string, number>();
  for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
  const v: Vec = new Map();
  for (const [w, n] of tf) v.set(w, n * (idf.get(w) ?? 1));
  return v;
}

function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  for (const [w, x] of a) dot += x * (b.get(w) ?? 0);
  const norm = (v: Vec) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
  const d = norm(a) * norm(b);
  return d ? dot / d : 0;
}

/** Everything a group says about itself, including the keywords the org wrote for it. */
const textOf = (g: Group) => `${g.title ?? ''} ${g.name} ${g.description} ${(g.keywords ?? []).join(' ')}`;

/** A match rule as readable words: `lp-*` -> ["lp"], `*-api` -> ["api"]. */
const ruleWords = (rule: string) => tokens(rule.replace(/\*/g, ' '));

/** Only groups that can hold repos: leaves, and groups with rules of their own. */
const candidates = (order: Node[]) => order.filter((n) => n.group.groups.length === 0 || n.group.match.length > 0);

export function suggest(groups: Group[], repo: { name: string; description?: string | null }): Suggestion {
  const order = postOrder(groups);

  const hit = pickIn(order, repo.name);
  if (hit) return { source: 'rule', key: hit.key, rule: ruleFor(hit.group, repo.name), score: 1, margin: 1, ranking: [{ key: hit.key, score: 1 }] };

  const nodes = candidates(order);
  if (!nodes.length) return { source: 'uncertain', key: null, score: 0, margin: 0, ranking: [] };

  // idf over everything a group says, so words shared by every group count for little.
  const docs = nodes.map(({ group: g }) => [...tokens(textOf(g)), ...g.match.flatMap(ruleWords)]);
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [w, n] of df) idf.set(w, Math.log(1 + nodes.length / n));

  const query = vec([...tokens(repo.name), ...tokens(repo.description ?? '')], idf);

  const ranking: Candidate[] = nodes
    .map(({ group: g, key }) => {
      const text = vec(tokens(textOf(g)), idf);
      // Names already in `match` and the org's keywords are both short, explicit signals: compare each one on its own.
      const examples = [...g.match.map((r) => r.replace(/\*/g, ' ')), ...(g.keywords ?? [])].map((x) => cosine(query, vec(tokens(x), idf)));
      const sText = cosine(query, text);
      const sEx = examples.length ? Math.max(...examples) : sText;
      return { key, score: W_TEXT * sText + W_EXAMPLES * sEx };
    })
    .sort((a, b) => b.score - a.score);

  const [first, second] = ranking;
  const margin = first.score - (second?.score ?? 0);
  const confident = first.score >= THRESHOLDS.minScore && margin >= THRESHOLDS.minMargin;
  return { source: confident ? 'lexical' : 'uncertain', key: confident ? first.key : null, score: first.score, margin, ranking };
}
