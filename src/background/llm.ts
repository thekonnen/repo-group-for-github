import { slugify } from '../core/edit';
import type { FetchLike } from './api';
import type { KV } from './kv';

/**
 * LLM fallback for repositories the local rules and score cannot place. Background worker only: the key never
 * reaches a page. Default provider is Gemini (Google AI Studio): the user pastes a key and the worker finds a model
 * that is answering right now, because on the free tier models come and go and hit quotas.
 */

export const GEMINI_NATIVE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_OPENAI = `${GEMINI_NATIVE}/openai`;
export const GEMINI_KEYS_URL = 'https://aistudio.google.com/api-keys';

export interface LlmConfig {
  mode: 'gemini' | 'custom';
  apiKey: string;
  /** custom only: OpenAI-compatible base URL (".../v1", the worker appends /chat/completions). */
  baseUrl?: string;
  /** custom only. */
  model?: string;
  /** Ask the AI on its own when no rule matches a new repository name. On unless turned off. */
  auto?: boolean;
}

/** What a page may see: never the key. */
export interface LlmStatus {
  configured: boolean;
  mode?: 'gemini' | 'custom';
  baseUrl?: string;
  model?: string;
  /** Gemini: the model that answered last. */
  activeModel?: string;
  /** Classify with the AI by default (see LlmConfig.auto). */
  auto: boolean;
  keysUrl: string;
}

const CONFIG_KEY = 'rg:llm';
const ACTIVE_KEY = 'rg:llm:model';
const COOL_KEY = 'rg:llm:cooldown';
const COOLDOWN_MS = 10 * 60_000;
const MAX_TRIES = 5;
const MODELS_TTL_MS = 60 * 60_000;

export class LlmError extends Error {}

export const loadLlmConfig = (kv: KV) => kv.get<LlmConfig>(CONFIG_KEY);

export async function llmStatus(kv: KV): Promise<LlmStatus> {
  const c = await loadLlmConfig(kv);
  if (!c?.apiKey) return { configured: false, auto: true, keysUrl: GEMINI_KEYS_URL };
  return {
    configured: true,
    mode: c.mode,
    baseUrl: c.mode === 'custom' ? c.baseUrl : undefined,
    model: c.mode === 'custom' ? c.model : undefined,
    activeModel: c.mode === 'gemini' ? await kv.get<string>(ACTIVE_KEY) : undefined,
    auto: c.auto !== false,
    keysUrl: GEMINI_KEYS_URL,
  };
}

/** An empty `apiKey` keeps the stored one, so the form never has to hold the secret. */
export async function saveLlmConfig(kv: KV, input: Partial<LlmConfig>): Promise<LlmStatus> {
  const old = await loadLlmConfig(kv);
  const mode = input.mode === 'custom' ? 'custom' : 'gemini';
  const apiKey = (input.apiKey ?? '').trim() || old?.apiKey || '';
  if (!apiKey) throw new LlmError('Paste an API key first.');
  const next: LlmConfig = { mode, apiKey, ...(old?.auto === false ? { auto: false } : {}) };
  if (mode === 'custom') {
    const baseUrl = (input.baseUrl ?? '').trim().replace(/\/+$/, '');
    const model = (input.model ?? '').trim();
    if (!/^https:\/\/[^\s/]+/i.test(baseUrl)) throw new LlmError('The endpoint must be an https:// URL.');
    if (!model) throw new LlmError('Enter the model name for your endpoint.');
    next.baseUrl = baseUrl;
    next.model = model;
  }
  await kv.set(CONFIG_KEY, next);
  await kv.remove(ACTIVE_KEY);
  await kv.remove(COOL_KEY);
  return llmStatus(kv);
}

export async function setLlmAuto(kv: KV, auto: boolean): Promise<LlmStatus> {
  const c = await loadLlmConfig(kv);
  if (!c?.apiKey) throw new LlmError('Paste an API key first.');
  await kv.set(CONFIG_KEY, { ...c, auto });
  return llmStatus(kv);
}

export async function clearLlmConfig(kv: KV): Promise<LlmStatus> {
  for (const k of [CONFIG_KEY, ACTIVE_KEY, COOL_KEY]) await kv.remove(k);
  return llmStatus(kv);
}

/** Origin the browser must grant (optional host permission) before the worker may call the provider. */
export function llmOrigin(c: Pick<LlmConfig, 'mode' | 'baseUrl'>): string | null {
  try {
    return new URL(c.mode === 'gemini' ? GEMINI_NATIVE : c.baseUrl ?? '').origin + '/*';
  } catch {
    return null;
  }
}

// ---- Gemini: pick the model that is answering ----

const SKIP = /embed|imagen|veo|tts|image|live|audio|aqa|robotics|computer|gemma|learnlm|vision/i;

/** Lower is tried first. No fixed model names, so it survives renames: stable before preview, lite/flash before pro, newer first. */
export function modelRank(name: string): number {
  const version = Number(/(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0);
  const preview = /preview|exp|beta/i.test(name) ? 1000 : 0;
  const tier = /lite/i.test(name) ? 0 : /flash/i.test(name) ? 10 : /pro/i.test(name) ? 30 : 20;
  return preview + tier - version;
}

export function orderModels(raw: { name?: string; supportedGenerationMethods?: string[] }[]): string[] {
  return raw
    .filter((m) => m.name && (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name!.replace(/^models\//, ''))
    .filter((n) => /gemini/i.test(n) && !SKIP.test(n))
    .sort((a, b) => modelRank(a) - modelRank(b));
}

async function listGeminiModels(fetch: FetchLike, kv: KV, apiKey: string, now: number): Promise<string[]> {
  const cached = await kv.get<{ at: number; models: string[] }>('rg:llm:models');
  if (cached && now - cached.at < MODELS_TTL_MS && cached.models.length) return cached.models;
  const res = await fetch(`${GEMINI_NATIVE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) throw new LlmError(await failure(res, 'Could not list Gemini models'));
  const models = orderModels(((await res.json()) as any).models ?? []);
  if (!models.length) throw new LlmError('This key can not use any Gemini text model.');
  await kv.set('rg:llm:models', { at: now, models });
  return models;
}

async function failure(res: Response, prefix: string): Promise<string> {
  let msg = '';
  try {
    msg = String((await res.json())?.error?.message ?? '');
  } catch {}
  return `${prefix} (HTTP ${res.status})${msg ? `: ${msg}` : ''}`;
}

async function chat(fetch: FetchLike, base: string, apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new LlmError(await failure(res, `Model ${model} failed`));
  const text = ((await res.json()) as any).choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new LlmError(`Model ${model} returned an empty answer.`);
  return text.trim();
}

/**
 * Sends a prompt and returns { text, model }. Gemini: tries the model that answered last, then the others in
 * `modelRank` order, putting a model that failed on a 10-minute cooldown. The first one that answers becomes the default.
 */
export async function askLlm(deps: { fetch: FetchLike; kv: KV; now?: () => number; /** Models to try before giving up (default 5). */ maxTries?: number }, prompt: string): Promise<{ text: string; model: string }> {
  const c = await loadLlmConfig(deps.kv);
  if (!c?.apiKey) throw new LlmError('No AI key set. Add one in Options > AI assistant.');
  const now = (deps.now ?? Date.now)();

  if (c.mode === 'custom') {
    return { text: await chat(deps.fetch, c.baseUrl!, c.apiKey, c.model!, prompt), model: c.model! };
  }

  const models = await listGeminiModels(deps.fetch, deps.kv, c.apiKey, now);
  const cool = (await deps.kv.get<Record<string, number>>(COOL_KEY)) ?? {};
  const active = await deps.kv.get<string>(ACTIVE_KEY);
  const order = [...(active && models.includes(active) ? [active] : []), ...models.filter((m) => m !== active)];
  let pool = order.filter((m) => (cool[m] ?? 0) <= now);
  if (!pool.length) pool = order; // everything cooling down: try again rather than fail without asking

  let last = 'No model answered.';
  for (const model of pool.slice(0, deps.maxTries ?? MAX_TRIES)) {
    try {
      const text = await chat(deps.fetch, GEMINI_OPENAI, c.apiKey, model, prompt);
      await deps.kv.set(ACTIVE_KEY, model);
      if (cool[model]) {
        delete cool[model];
        await deps.kv.set(COOL_KEY, cool);
      }
      return { text, model };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      cool[model] = now + COOLDOWN_MS;
      await deps.kv.set(COOL_KEY, cool);
    }
  }
  // The cached list may be stale (a model was retired): drop it so the next call lists again.
  await deps.kv.remove('rg:llm:models');
  throw new LlmError(`No Gemini model answered. Last error: ${last}`);
}

// ---- classification prompt ----

export interface GroupChoice {
  key: string;
  title?: string;
  description: string;
  /** The org's own words for the group (repo-groups.yml `keywords`): they tell the AI what belongs there. */
  keywords?: string[];
}

export function classifyPrompt(groups: GroupChoice[], repo: { name: string; description?: string | null }): string {
  const list = groups.map((g) => `- ${g.key}: ${g.title ?? g.key}. ${g.description}${g.keywords?.length ? ` Keywords: ${g.keywords.join(', ')}.` : ''}`.trim()).join('\n');
  return (
    `Pick the single best group for this repository. Answer with the group key only, exactly as written.\n` +
    `If no group fits, answer with one line instead: NEW: <slug-path> | <Title path> | <description of level 1> | <description of level 2> ... ` +
    `The slug-path is lowercase slugs separated by "/" (at most 3 levels; an existing group may be the parent), ` +
    `the Title path has the display names separated by " / ", and each description is one short sentence about that level alone. ` +
    `Example: NEW: selfhosted-infra/storage | Self-hosted infra / Storage | Services you host yourself | Self-hosted object and file storage.\n` +
    `Answer "none" only if the name gives no hint at all.\n\n` +
    `Groups:\n${list}\n\nRepository: ${repo.name}\nDescription: ${repo.description || '(none)'}`
  );
}

/** The group key in the model's answer, tolerating quotes, backticks and extra words. Longest key wins. */
export function parseChoice(answer: string, keys: string[]): string | null {
  const clean = answer.trim().replace(/^[`"'\s]+|[`"'\s.]+$/g, '');
  if (keys.includes(clean)) return clean;
  if (/^\s*NEW\s*:/im.test(answer)) return null; // a proposal for a new group, not a choice
  const found = [...keys].sort((a, b) => b.length - a.length).find((k) => answer.includes(k));
  return found ?? null;
}

/** A group the AI proposes to create when none fits. Slugs are sanitized; anything malformed is dropped. */
export interface NewGroupProposal {
  /** Slugs from the top: ["selfhosted-infra", "storage"]. */
  path: string[];
  /** Display name for each slug. */
  titles: string[];
  /** One sentence per level, so any prefix of the path can be created on its own. */
  descriptions: string[];
}

const SLUG = /^[a-z0-9._-]+$/;
const clean = (x: string, max: number) => x.replace(/\s+/g, ' ').trim().slice(0, max);

export function parseNewGroup(answer: string): NewGroupProposal | null {
  const m = /^\s*NEW\s*:\s*(.+)$/im.exec(answer);
  if (!m) return null;
  const [rawPath = '', rawTitles = '', ...rawDescs] = m[1].split('|').map((x) => x.trim());
  const path = rawPath.split('/').map((x) => slugify(x.trim()));
  if (path.length < 1 || path.length > 3 || path.some((x) => !x || !SLUG.test(x))) return null;
  const given = rawTitles.split('/').map((x) => clean(x, 60));
  // a title per slug; when the model gave a different count, the slugs stand in
  const titles = path.map((slug, i) => (given.length === path.length ? given[i] : '') || slug);
  const descs = rawDescs.map((d) => clean(d, 140));
  const descriptions = path.map((_, i) => {
    if (descs.length === path.length) return descs[i];
    if (descs.length === 1) return i === path.length - 1 ? descs[0] : ''; // one sentence describes the deepest level
    return descs[i] ?? '';
  });
  // a level without its own sentence still gets one, so it is useful for the next classification
  return { path, titles, descriptions: descriptions.map((d, i) => d || `Repositories for ${titles[i]}.`) };
}
