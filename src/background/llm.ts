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

export type Provider = 'gemini' | 'custom';
export const PROVIDER_LABEL: Record<Provider, string> = { gemini: 'Gemini', custom: 'Custom endpoint' };

/**
 * Both providers can be stored at once. `primary` is tried first; with `fallback` on (the default) and both set,
 * the other one answers when the first fails. Saving one never touches the other.
 */
export interface LlmConfig {
  primary: Provider;
  gemini?: { apiKey: string };
  /** OpenAI-compatible: `baseUrl` is ".../v1", the worker appends /chat/completions. */
  custom?: { apiKey: string; baseUrl: string; model: string };
  /** Use the other provider when the first fails. On unless turned off. */
  fallback?: boolean;
  /** Ask the AI on its own when no rule matches a new repository name. On unless turned off. */
  auto?: boolean;
}

/** What a page may see: never a key. */
export interface LlmStatus {
  /** At least one provider has a key. */
  configured: boolean;
  /** The provider tried first. */
  mode?: Provider;
  gemini: { configured: boolean };
  custom: { configured: boolean; baseUrl?: string; model?: string };
  /** Use the other provider when the first fails (only effective when both are set). */
  fallback: boolean;
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

/** Providers that have what they need to be called. */
export const configuredProviders = (c: LlmConfig | undefined): Provider[] => (['gemini', 'custom'] as const).filter((p) => !!c?.[p]?.apiKey);
export const llmConfigured = (c: LlmConfig | undefined): boolean => configuredProviders(c).length > 0;

/** Reads the stored config; the first version stored one provider as { mode, apiKey, baseUrl, model } and is converted. */
export async function loadLlmConfig(kv: KV): Promise<LlmConfig | undefined> {
  const raw = await kv.get<any>(CONFIG_KEY);
  if (!raw) return undefined;
  if (raw.primary) return raw as LlmConfig;
  if (!raw.apiKey) return undefined;
  const base = { ...(raw.auto === false ? { auto: false } : {}) };
  return raw.mode === 'custom'
    ? { primary: 'custom', custom: { apiKey: raw.apiKey, baseUrl: raw.baseUrl ?? '', model: raw.model ?? '' }, ...base }
    : { primary: 'gemini', gemini: { apiKey: raw.apiKey }, ...base };
}

export async function llmStatus(kv: KV): Promise<LlmStatus> {
  const c = await loadLlmConfig(kv);
  const have = configuredProviders(c);
  return {
    configured: have.length > 0,
    mode: have.length ? (c!.primary && have.includes(c!.primary) ? c!.primary : have[0]) : undefined,
    gemini: { configured: have.includes('gemini') },
    custom: { configured: have.includes('custom'), baseUrl: c?.custom?.baseUrl, model: c?.custom?.model },
    fallback: c?.fallback !== false,
    activeModel: have.includes('gemini') ? await kv.get<string>(ACTIVE_KEY) : undefined,
    auto: c?.auto !== false,
    keysUrl: GEMINI_KEYS_URL,
  };
}

/**
 * Saves ONE provider (the one selected in Options) and makes it the primary. The other provider is left exactly as it
 * was, so a custom endpoint stays saved while Gemini is selected. An empty key keeps that provider's own stored key.
 */
export async function saveLlmConfig(kv: KV, input: { mode?: Provider; apiKey?: string; baseUrl?: string; model?: string }): Promise<LlmStatus> {
  const old = await loadLlmConfig(kv);
  const mode: Provider = input.mode === 'custom' ? 'custom' : 'gemini';
  const key = (input.apiKey ?? '').trim();
  const next: LlmConfig = { ...old, primary: mode };
  if (mode === 'gemini') {
    const apiKey = key || old?.gemini?.apiKey || '';
    if (!apiKey) throw new LlmError('Paste a Gemini API key first.');
    next.gemini = { apiKey };
    if (key) {
      await kv.remove(ACTIVE_KEY); // a new key: models and cooldowns may differ
      await kv.remove(COOL_KEY);
      await kv.remove('rg:llm:models');
    }
  } else {
    const baseUrl = ((input.baseUrl ?? '').trim() || old?.custom?.baseUrl || '').replace(/\/+$/, '');
    const model = (input.model ?? '').trim() || old?.custom?.model || '';
    const apiKey = key || old?.custom?.apiKey || '';
    if (!/^https:\/\/[^\s/]+/i.test(baseUrl)) throw new LlmError('The endpoint must be an https:// URL.');
    if (!model) throw new LlmError('Enter the model name for your endpoint.');
    if (!apiKey) throw new LlmError('Paste the API key of your endpoint first.');
    next.custom = { apiKey, baseUrl, model };
  }
  await kv.set(CONFIG_KEY, next);
  return llmStatus(kv);
}

const needKey = (c: LlmConfig | undefined): LlmConfig => {
  if (!llmConfigured(c)) throw new LlmError('Paste an API key first.');
  return c!;
};

export async function setLlmAuto(kv: KV, auto: boolean): Promise<LlmStatus> {
  await kv.set(CONFIG_KEY, { ...needKey(await loadLlmConfig(kv)), auto });
  return llmStatus(kv);
}

export async function setLlmFallback(kv: KV, fallback: boolean): Promise<LlmStatus> {
  await kv.set(CONFIG_KEY, { ...needKey(await loadLlmConfig(kv)), fallback });
  return llmStatus(kv);
}

/** Removes one provider (the other stays and becomes the primary), or everything when no provider is given. */
export async function clearLlmConfig(kv: KV, mode?: Provider): Promise<LlmStatus> {
  const c = await loadLlmConfig(kv);
  if (mode && c) {
    const rest: LlmConfig = { ...c };
    delete rest[mode];
    const left = configuredProviders(rest);
    if (left.length) {
      await kv.set(CONFIG_KEY, { ...rest, primary: left[0] });
      if (mode === 'gemini') for (const k of [ACTIVE_KEY, COOL_KEY, 'rg:llm:models']) await kv.remove(k);
      return llmStatus(kv);
    }
  }
  for (const k of [CONFIG_KEY, ACTIVE_KEY, COOL_KEY, 'rg:llm:models']) await kv.remove(k);
  return llmStatus(kv);
}

/** Origin the browser must grant (optional host permission) before the worker may call the provider. */
export function llmOrigin(c: { mode: Provider; baseUrl?: string }): string | null {
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
 * Gemini: tries the model that answered last, then the others in `modelRank` order, putting a model that failed on a
 * 10-minute cooldown. The first one that answers becomes the default.
 */
async function askGemini(deps: { fetch: FetchLike; kv: KV; now: number; maxTries?: number }, apiKey: string, prompt: string): Promise<{ text: string; model: string }> {
  const { now } = deps;
  const models = await listGeminiModels(deps.fetch, deps.kv, apiKey, now);
  const cool = (await deps.kv.get<Record<string, number>>(COOL_KEY)) ?? {};
  const active = await deps.kv.get<string>(ACTIVE_KEY);
  const order = [...(active && models.includes(active) ? [active] : []), ...models.filter((m) => m !== active)];
  let pool = order.filter((m) => (cool[m] ?? 0) <= now);
  if (!pool.length) pool = order; // everything cooling down: try again rather than fail without asking

  let last = 'No model answered.';
  for (const model of pool.slice(0, deps.maxTries ?? MAX_TRIES)) {
    try {
      const text = await chat(deps.fetch, GEMINI_OPENAI, apiKey, model, prompt);
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

export interface LlmAnswer {
  text: string;
  model: string;
  provider: Provider;
  /** The primary failed and the other provider answered. */
  fallback: boolean;
}

/**
 * Sends a prompt. Providers are tried in order (primary first, then the other one when `fallback` is on); the first
 * that answers wins. `only` asks a single provider with no fallback (the Test button). `canUse` lets the caller skip a
 * provider the browser has not allowed yet. With one provider tried, its own error is thrown; with two, both are listed.
 */
export async function askLlm(
  deps: { fetch: FetchLike; kv: KV; now?: () => number; /** Models to try per Gemini call (default 5). */ maxTries?: number; only?: Provider; canUse?: (origin: string) => Promise<boolean> },
  prompt: string,
): Promise<LlmAnswer> {
  const c = await loadLlmConfig(deps.kv);
  const have = configuredProviders(c);
  if (!c || !have.length) throw new LlmError('No AI key set. Add one in Options > AI assistant.');
  const first = have.includes(c.primary) ? c.primary : have[0];
  const order: Provider[] = deps.only
    ? have.includes(deps.only) ? [deps.only] : []
    : c.fallback === false ? [first] : [first, ...have.filter((p) => p !== first)];
  if (!order.length) throw new LlmError(`${PROVIDER_LABEL[deps.only!]} is not set up. Save its settings first.`);
  const now = (deps.now ?? Date.now)();

  const errors: string[] = [];
  for (const [i, p] of order.entries()) {
    try {
      const origin = llmOrigin({ mode: p, baseUrl: c.custom?.baseUrl });
      if (deps.canUse && origin && !(await deps.canUse(origin))) {
        throw new LlmError(`The browser has not allowed requests to ${origin.replace('/*', '')}. Save the ${PROVIDER_LABEL[p]} settings again and accept the prompt.`);
      }
      const r = p === 'gemini' ? await askGemini({ fetch: deps.fetch, kv: deps.kv, now, maxTries: deps.maxTries }, c.gemini!.apiKey, prompt) : { text: await chat(deps.fetch, c.custom!.baseUrl, c.custom!.apiKey, c.custom!.model, prompt), model: c.custom!.model };
      return { ...r, provider: p, fallback: i > 0 };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (order.length === 1) throw new LlmError(errors[0]);
  throw new LlmError(order.map((p, i) => `${PROVIDER_LABEL[p]}: ${errors[i]}`).join(' | '));
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
