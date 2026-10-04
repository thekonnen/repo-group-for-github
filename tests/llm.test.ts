import { describe, expect, it } from 'vitest';
import { createHandler } from '../src/background/handlers';
import { memoryKV } from '../src/background/kv';
import { askLlm, classifyPrompt, clearLlmConfig, llmOrigin, llmStatus, loadLlmConfig, modelRank, orderModels, parseChoice, parseNewGroup, saveLlmConfig, setLlmAuto, setLlmFallback } from '../src/background/llm';
import { memoryIndexStore } from '../src/background/repo-index';
import { fakeFetch, type Route } from './fake-github';

const gen = ['generateContent'];
const MODELS = [
  { name: 'models/gemini-2.5-pro', supportedGenerationMethods: gen },
  { name: 'models/gemini-2.5-flash', supportedGenerationMethods: gen },
  { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: gen },
  { name: 'models/gemini-3-flash-preview', supportedGenerationMethods: gen },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: gen },
  { name: 'models/gemma-3-27b-it', supportedGenerationMethods: gen },
];

/** Gemini fake: model list + chat. `fail` maps a model to the HTTP status it answers with. */
function gemini(fail: Record<string, number> = {}, answer = 'OK'): Route {
  return (url, call) => {
    if (url.hostname !== 'generativelanguage.googleapis.com') return undefined;
    if (url.pathname === '/v1beta/models') return { json: { models: MODELS } };
    if (url.pathname === '/v1beta/openai/chat/completions') {
      const model = JSON.parse(call.body!).model as string;
      if (fail[model]) return { status: fail[model], json: { error: { message: 'quota' } } };
      return { json: { choices: [{ message: { content: answer } }] } };
    }
  };
}

const ready = async (key = 'AIza-test') => {
  const kv = memoryKV();
  await saveLlmConfig(kv, { mode: 'gemini', apiKey: key });
  return kv;
};

describe('model ordering', () => {
  it('keeps only Gemini text models, stable and lite/flash first, newer first', () => {
    expect(orderModels(MODELS)).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-flash-preview']);
  });
  it('ranks a newer stable model ahead of an older one in the same tier', () => {
    expect(modelRank('gemini-3-flash')).toBeLessThan(modelRank('gemini-2.5-flash'));
  });
});

describe('config', () => {
  it('never exposes the key and keeps it when the field is empty', async () => {
    const kv = memoryKV();
    await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'secret' });
    const again = await saveLlmConfig(kv, { mode: 'gemini', apiKey: '' });
    expect(JSON.stringify(again)).not.toContain('secret');
    expect(again).toMatchObject({ configured: true, mode: 'gemini' });
  });
  it('needs a key, an https endpoint and a model for a custom provider', async () => {
    const kv = memoryKV();
    await expect(saveLlmConfig(kv, { mode: 'gemini', apiKey: '' })).rejects.toThrow(/key/);
    await expect(saveLlmConfig(kv, { mode: 'custom', apiKey: 'k', baseUrl: 'http://x', model: 'm' })).rejects.toThrow(/https/);
    await expect(saveLlmConfig(kv, { mode: 'custom', apiKey: 'k', baseUrl: 'https://x/v1', model: '' })).rejects.toThrow(/model/);
    expect(await llmStatus(kv)).toMatchObject({ configured: false });
  });
  it('maps each mode to the origin the browser must allow', () => {
    expect(llmOrigin({ mode: 'gemini' })).toBe('https://generativelanguage.googleapis.com/*');
    expect(llmOrigin({ mode: 'custom', baseUrl: 'https://llm.example.com/v1' })).toBe('https://llm.example.com/*');
  });
});

describe('askLlm with Gemini', () => {
  it('uses the best model and remembers it, sending the key as a header', async () => {
    const f = fakeFetch(gemini());
    const kv = await ready();
    const r = await askLlm({ fetch: f.fetch, kv }, 'hi');
    expect(r).toEqual({ text: 'OK', model: 'gemini-2.5-flash-lite', provider: 'gemini', fallback: false });
    expect((await llmStatus(kv)).activeModel).toBe('gemini-2.5-flash-lite');
    expect(f.calls[0].headers['x-goog-api-key']).toBe('AIza-test');
    expect(f.calls[0].url).not.toContain('AIza-test');
  });

  it('moves to the next model when one is out of quota, and starts from the working one next time', async () => {
    const f = fakeFetch(gemini({ 'gemini-2.5-flash-lite': 429 }));
    const kv = await ready();
    expect((await askLlm({ fetch: f.fetch, kv }, 'hi')).model).toBe('gemini-2.5-flash');
    const before = f.calls.length;
    expect((await askLlm({ fetch: f.fetch, kv }, 'hi')).model).toBe('gemini-2.5-flash');
    // second call: one request, straight to the remembered model (list is cached)
    expect(f.calls.length - before).toBe(1);
  });

  it('retries a cooled-down model after the cooldown', async () => {
    let t = 1_000_000;
    const fail: Record<string, number> = { 'gemini-2.5-flash-lite': 503 };
    const f = fakeFetch(gemini(fail));
    const kv = await ready();
    expect((await askLlm({ fetch: f.fetch, kv, now: () => t }, 'hi')).model).toBe('gemini-2.5-flash');
    delete fail['gemini-2.5-flash-lite'];
    fail['gemini-2.5-flash'] = 503;
    // inside the cooldown the recovered model is skipped: the next one in line answers
    expect((await askLlm({ fetch: f.fetch, kv, now: () => t + 60_000 }, 'hi')).model).toBe('gemini-2.5-pro');
    fail['gemini-2.5-pro'] = 503;
    // after the cooldown it is a candidate again
    expect((await askLlm({ fetch: f.fetch, kv, now: () => t + 11 * 60_000 }, 'hi')).model).toBe('gemini-2.5-flash-lite');
  });

  it('reports the last error when no model answers and drops the cached list', async () => {
    const f = fakeFetch(gemini({ 'gemini-2.5-flash-lite': 429, 'gemini-2.5-flash': 429, 'gemini-2.5-pro': 429, 'gemini-3-flash-preview': 503 }));
    const kv = await ready();
    await expect(askLlm({ fetch: f.fetch, kv }, 'hi')).rejects.toThrow(/No Gemini model answered.*quota/);
    expect(await kv.get('rg:llm:models')).toBeUndefined();
  });

  it('surfaces a bad key from the model list', async () => {
    const f = fakeFetch((u) => (u.pathname === '/v1beta/models' ? { status: 400, json: { error: { message: 'API key not valid' } } } : undefined));
    await expect(askLlm({ fetch: f.fetch, kv: await ready('bad') }, 'hi')).rejects.toThrow(/API key not valid/);
  });

  it('asks to set a key first', async () => {
    await expect(askLlm({ fetch: fakeFetch().fetch, kv: memoryKV() }, 'hi')).rejects.toThrow(/Options/);
  });
});

describe('askLlm with a custom endpoint', () => {
  it('posts to the endpoint with the chosen model and no model cycling', async () => {
    const f = fakeFetch((u, c) => (u.hostname === 'llm.example.com' ? { json: { choices: [{ message: { content: 'hello' } }] } } : undefined));
    const kv = memoryKV();
    await saveLlmConfig(kv, { mode: 'custom', apiKey: 'k', baseUrl: 'https://llm.example.com/v1/', model: 'my-model' });
    expect(await askLlm({ fetch: f.fetch, kv }, 'hi')).toEqual({ text: 'hello', model: 'my-model', provider: 'custom', fallback: false });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('https://llm.example.com/v1/chat/completions');
    expect(JSON.parse(f.calls[0].body!).model).toBe('my-model');
    expect(f.calls[0].headers.authorization).toBe('Bearer k');
  });
});

describe('answer parsing', () => {
  const keys = ['infra', 'infra/cloud', 'products/ai-tools'];
  it.each([
    ['infra/cloud', 'infra/cloud'],
    ['`infra/cloud`', 'infra/cloud'],
    ['"products/ai-tools".', 'products/ai-tools'],
    ['Best fit: infra/cloud because it is storage', 'infra/cloud'],
    ['infra', 'infra'],
    ['none', null],
    ['no idea', null],
  ])('%s -> %s', (answer, expected) => expect(parseChoice(answer, keys)).toBe(expected));

  it('lists every group with its key in the prompt', () => {
    const p = classifyPrompt([{ key: 'infra/cloud', title: 'Cloud', description: 'Storage.' }], { name: 'minio', description: 's3' });
    expect(p).toContain('infra/cloud: Cloud. Storage.');
    expect(p).toContain('Repository: minio');
  });
});

describe('suggest:group through the handler', () => {
  const yml = ['groups:', '  - name: infra', '    title: "Infra"', '    groups:', '      - name: cloud', '        title: "Cloud e storage"', '        description: "Setup de cloud e armazenamento."', '        match: ["acme-storage"]', '      - name: monitoring', '        title: "Monitoramento"', '        description: "Logs e métricas."', '  - name: products', '    groups:', '      - name: ai-tools', '        title: "IA"', '        description: "Extensões com IA."'].join('\n');
  const file: Route = (u) => (u.pathname === '/repos/o/.github/contents/repo-groups.yml' ? { json: { content: btoa(yml), sha: 'abc' }, headers: { etag: '"e"' } } : undefined);
  const make = async (llmRoute: Route, configure = true) => {
    const f = fakeFetch(file, llmRoute);
    const kv = memoryKV();
    if (configure) await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'k' });
    const handle = createHandler({ fetch: f.fetch, kv, index: memoryIndexStore() });
    return { f, handle };
  };

  it('answers from rules or the local score without calling the AI', async () => {
    const { f, handle } = await make(gemini());
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'acme-storage' } });
    expect(r.data).toMatchObject({ source: 'rule', key: 'infra/cloud' });
    expect(f.calls.some((c) => c.url.includes('generativelanguage'))).toBe(false);
  });

  it('asks the AI when the score is unsure and uses its answer', async () => {
    const { handle } = await make(gemini({}, 'infra/cloud'));
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'xyz' } });
    expect(r.data).toMatchObject({ source: 'llm', key: 'infra/cloud', model: 'gemini-2.5-flash-lite' });
  });

  it('stays uncertain, with the reason, when the AI fails', async () => {
    const { handle } = await make(gemini({ 'gemini-2.5-flash-lite': 429, 'gemini-2.5-flash': 429, 'gemini-2.5-pro': 429, 'gemini-3-flash-preview': 429 }));
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'xyz' } });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ source: 'uncertain', key: null });
    expect(r.data.llmError).toMatch(/No Gemini model answered/);
  });

  it('does not call the AI when no key is set', async () => {
    const { f, handle } = await make(gemini(), false);
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'xyz' } });
    expect(r.data).toMatchObject({ source: 'uncertain', key: null });
    expect(f.calls.some((c) => c.url.includes('generativelanguage'))).toBe(false);
  });

  it('blocks the call when the browser has not granted the provider origin', async () => {
    const f = fakeFetch(file, gemini({}, 'infra/cloud'));
    const kv = memoryKV();
    await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'k' });
    const handle = createHandler({ fetch: f.fetch, kv, index: memoryIndexStore(), origins: { has: async () => false, request: async () => false } });
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'xyz' } });
    expect(r.data.llmError).toMatch(/not allowed/);
    expect(f.calls.some((c) => c.url.includes('generativelanguage'))).toBe(false);
  });

  it('never returns the key from llm:status', async () => {
    const { handle } = await make(gemini());
    const r: any = await handle({ type: 'llm:status' });
    expect(JSON.stringify(r)).not.toContain('"k"');
    expect(r.data).toMatchObject({ configured: true, mode: 'gemini' });
  });

  it('method "keywords" never calls the AI, even when the score is unsure', async () => {
    const { f, handle } = await make(gemini({}, 'infra/cloud'));
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'xyz' }, method: 'keywords' });
    expect(r.data).toMatchObject({ source: 'uncertain', key: null });
    expect(f.calls.some((c) => c.url.includes('generativelanguage'))).toBe(false);
  });

  it('method "llm" asks the AI even when a rule already places the name', async () => {
    const { f, handle } = await make(gemini({}, 'infra/monitoring'));
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'acme-storage' }, method: 'llm' });
    expect(r.data).toMatchObject({ source: 'llm', key: 'infra/monitoring' });
    expect(f.calls.some((c) => c.url.includes('chat/completions'))).toBe(true);
  });

  it('method "llm" without a key reports it instead of looking answered', async () => {
    const { handle } = await make(gemini(), false);
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'xyz' }, method: 'llm' });
    expect(r.data).toMatchObject({ source: 'uncertain', key: null });
    expect(r.data.llmError).toMatch(/Options/);
  });

  it('shows what the AI answered when it picks no group', async () => {
    const { handle } = await make(gemini({}, 'none'));
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'xyz' }, method: 'llm' });
    expect(r.data).toMatchObject({ source: 'uncertain', key: null });
    expect(r.data.llmError).toBe('The AI found no fitting group (it answered: "none").');
  });

  it('turns a NEW proposal into a group to create, not a choice', async () => {
    const { handle } = await make(gemini({}, 'NEW: selfhosted-infra/storage | Self-hosted infra / Storage | Self-hosted storage services'));
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'minio' }, method: 'llm' });
    expect(r.data).toMatchObject({ source: 'uncertain', key: null, newGroup: { path: ['selfhosted-infra', 'storage'], titles: ['Self-hosted infra', 'Storage'], descriptions: ['Repositories for Self-hosted infra.', 'Self-hosted storage services'] } });
    expect(r.data.llmError).toBeUndefined();
  });
});

describe('new group proposals', () => {
  it.each([
    ['NEW: infra/storage | Infra / Storage | Object storage', { path: ['infra', 'storage'], titles: ['Infra', 'Storage'], descriptions: ['Repositories for Infra.', 'Object storage'] }],
    ['NEW: infra/storage | Infra / Storage | Hosting | Object storage', { path: ['infra', 'storage'], titles: ['Infra', 'Storage'], descriptions: ['Hosting', 'Object storage'] }],
    ['NEW: a/b/c | A / B / C | da | db | dc', { path: ['a', 'b', 'c'], titles: ['A', 'B', 'C'], descriptions: ['da', 'db', 'dc'] }],
    ['Sure.\nNEW: Self Hosted/Object Store | Self hosted / Object store | x', { path: ['self-hosted', 'object-store'], titles: ['Self hosted', 'Object store'], descriptions: ['Repositories for Self hosted.', 'x'] }],
    ['NEW: storage', { path: ['storage'], titles: ['storage'], descriptions: ['Repositories for storage.'] }],
    ['NEW: a/b | Only one title | d', { path: ['a', 'b'], titles: ['a', 'b'], descriptions: ['Repositories for a.', 'd'] }],
  ])('parses %j', (answer, expected) => expect(parseNewGroup(answer)).toEqual(expected));

  it.each([['none'], ['infra/cloud'], ['NEW: '], ['NEW: a/b/c/d | x | y'], ['NEW: !!! | x | y']])('ignores %j', (answer) => expect(parseNewGroup(answer)).toBeNull());

  it('never reads a NEW line as an existing group, even if it mentions one', () => {
    expect(parseChoice('NEW: infra/cloud-extra | Cloud extra | d', ['infra/cloud'])).toBeNull();
  });
});

describe('AI by default preference', () => {
  it('is on until turned off, survives a key change, and needs a key', async () => {
    const kv = memoryKV();
    await expect(setLlmAuto(kv, false)).rejects.toThrow(/key/);
    await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'k' });
    expect((await llmStatus(kv)).auto).toBe(true);
    expect((await setLlmAuto(kv, false)).auto).toBe(false);
    expect((await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'k2' })).auto).toBe(false);
    expect((await setLlmAuto(kv, true)).auto).toBe(true);
  });

  it('is reachable through the handler', async () => {
    const kv = memoryKV();
    await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'k' });
    const handle = createHandler({ fetch: fakeFetch().fetch, kv, index: memoryIndexStore() });
    expect(((await handle({ type: 'llm:auto', auto: false })) as any).data.auto).toBe(false);
  });
});

describe('keeping the number of AI requests low', () => {
  const yml = ['groups:', '  - name: infra', '    title: "Infra"', '    description: "Servers."', '    keywords: ["s3", "backup"]'].join('\n');
  const file: Route = (u) => (u.pathname === '/repos/o/.github/contents/repo-groups.yml' ? { json: { content: btoa(yml), sha: 'abc' }, headers: { etag: '"e"' } } : undefined);
  const setup = async (llm: Route, now = () => 1_000_000) => {
    const f = fakeFetch(file, llm);
    const kv = memoryKV();
    await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'k' });
    const handle = createHandler({ fetch: f.fetch, kv, index: memoryIndexStore(), now });
    const ask = (name: string, auto = false, description = '') => handle({ type: 'suggest:group', org: 'o', repo: { name, description }, method: 'llm', ...(auto ? { auto: true } : {}) }) as Promise<any>;
    const chats = () => f.calls.filter((c) => c.url.includes('chat/completions')).length;
    return { f, kv, ask, chats };
  };

  it('answers the same question from the cache', async () => {
    const { ask, chats } = await setup(gemini({}, 'infra'));
    expect((await ask('zzz-one')).data).toMatchObject({ source: 'llm', key: 'infra' });
    expect((await ask('zzz-one')).data).toMatchObject({ source: 'llm', key: 'infra' });
    expect((await ask('ZZZ-ONE')).data).toMatchObject({ key: 'infra' }); // case does not matter
    expect(chats()).toBe(1);
    await ask('zzz-two');
    expect(chats()).toBe(2);
  });

  it('caches "no group" and new-group answers too, but never errors', async () => {
    const none = await setup(gemini({}, 'none'));
    await none.ask('x1');
    await none.ask('x1');
    expect(none.chats()).toBe(1);

    const failing = await setup(gemini({ 'gemini-2.5-flash-lite': 429, 'gemini-2.5-flash': 429, 'gemini-2.5-pro': 429, 'gemini-3-flash-preview': 429 }));
    await failing.ask('x2');
    const before = failing.chats();
    await failing.ask('x2');
    expect(failing.chats()).toBeGreaterThan(before);
  });

  it('forgets cached answers when the groups change', async () => {
    const a = await setup(gemini({}, 'infra'));
    await a.ask('zzz-one');
    // same org and name, different groups file => different question
    const other = fakeFetch((u) => (u.pathname === '/repos/o/.github/contents/repo-groups.yml' ? { json: { content: btoa(yml + '\n  - name: apps\n    description: "Apps."'), sha: 'x' } } : undefined), gemini({}, 'infra'));
    await a.kv.remove('rg:file:o');
    const handle = createHandler({ fetch: other.fetch, kv: a.kv, index: memoryIndexStore() });
    await handle({ type: 'suggest:group', org: 'o', repo: { name: 'zzz-one' }, method: 'llm' });
    expect(other.calls.some((c) => c.url.includes('chat/completions'))).toBe(true);
  });

  it('shares one request between identical questions asked at the same time', async () => {
    const { ask, chats } = await setup(gemini({}, 'infra'));
    await Promise.all([ask('zzz-one', true), ask('zzz-one', true), ask('zzz-one')]);
    expect(chats()).toBe(1);
  });

  it('tries at most 2 models for an automatic run, 5 for a click', async () => {
    const allFail = { 'gemini-2.5-flash-lite': 429, 'gemini-2.5-flash': 429, 'gemini-2.5-pro': 429, 'gemini-3-flash-preview': 429 };
    const auto = await setup(gemini(allFail));
    await auto.ask('zzz-one', true);
    expect(auto.chats()).toBe(2);
    const click = await setup(gemini(allFail));
    await click.ask('zzz-one');
    expect(click.chats()).toBe(4); // only four models exist in this fake; the cap of 5 is not what stops it
  });

  it('pauses automatic runs for 10 minutes after a failure, and a click still works', async () => {
    let t = 1_000_000;
    const fail: Record<string, number> = { 'gemini-2.5-flash-lite': 429, 'gemini-2.5-flash': 429, 'gemini-2.5-pro': 429, 'gemini-3-flash-preview': 429 };
    const { ask, chats } = await setup(gemini(fail), () => t);
    await ask('zzz-one', true);
    const afterFailure = chats();
    const paused = (await ask('zzz-two', true)).data;
    expect(paused.llmError).toMatch(/paused/);
    expect(chats()).toBe(afterFailure); // no request while paused

    for (const k of Object.keys(fail)) delete fail[k];
    expect((await ask('zzz-two')).data.llmError).toMatch(/found no fitting group/); // a click is never blocked: the AI was really asked
    expect(chats()).toBeGreaterThan(afterFailure);

    t += 11 * 60_000;
    expect((await ask('zzz-three', true)).data.llmError ?? '').not.toMatch(/paused/);
  });

  it('caps automatic runs at 6 per minute', async () => {
    let t = 1_000_000;
    const { ask, chats } = await setup(gemini({}, 'infra'), () => t);
    for (let i = 0; i < 6; i++) await ask(`n-${i}`, true);
    expect(chats()).toBe(6);
    expect((await ask('n-6', true)).data.llmError).toMatch(/paused/);
    expect(chats()).toBe(6);
    expect((await ask('n-6')).data).toMatchObject({ key: 'infra' }); // a click goes through
    t += 61_000;
    expect((await ask('n-7', true)).data).toMatchObject({ key: 'infra' });
  });

  it('tells the AI the keywords of each group', async () => {
    const { f, ask } = await setup(gemini({}, 'infra'));
    await ask('zzz-one');
    const body = JSON.parse(f.calls.find((c) => c.url.includes('chat/completions'))!.body!);
    expect(body.messages[0].content).toContain('Keywords: s3, backup.');
  });
});

const CUSTOM = { mode: 'custom' as const, apiKey: 'ck', baseUrl: 'https://llm.example.com/v1', model: 'my-model' };
const customRoute = (status = 200, content = 'infra'): Route => (u) =>
  u.hostname === 'llm.example.com' ? { status, json: status === 200 ? { choices: [{ message: { content } }] } : { error: { message: 'custom down' } } } : undefined;
const GEMINI_DOWN = { 'gemini-2.5-flash-lite': 429, 'gemini-2.5-flash': 429, 'gemini-2.5-pro': 429, 'gemini-3-flash-preview': 429 };

describe('two providers', () => {
  it('keeps a saved custom endpoint when Gemini is saved, and the other way round', async () => {
    const kv = memoryKV();
    await saveLlmConfig(kv, CUSTOM);
    await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'gk' });
    let s = await llmStatus(kv);
    expect(s).toMatchObject({ mode: 'gemini', gemini: { configured: true }, custom: { configured: true, baseUrl: 'https://llm.example.com/v1', model: 'my-model' } });
    await saveLlmConfig(kv, { mode: 'custom' }); // nothing typed: the saved URL, model and key stay
    s = await llmStatus(kv);
    expect(s.mode).toBe('custom');
    expect(s.gemini.configured).toBe(true);
    expect((await loadLlmConfig(kv))?.custom).toEqual({ apiKey: 'ck', baseUrl: 'https://llm.example.com/v1', model: 'my-model' });
    expect((await loadLlmConfig(kv))?.gemini).toEqual({ apiKey: 'gk' });
  });

  it('never uses one provider\'s key for the other', async () => {
    const kv = memoryKV();
    await saveLlmConfig(kv, CUSTOM);
    await expect(saveLlmConfig(kv, { mode: 'gemini', apiKey: '' })).rejects.toThrow(/Gemini API key/);
    expect((await loadLlmConfig(kv))?.gemini).toBeUndefined();
    const other = memoryKV();
    await saveLlmConfig(other, { mode: 'gemini', apiKey: 'gk' });
    await expect(saveLlmConfig(other, { mode: 'custom', baseUrl: 'https://x.example/v1', model: 'm' })).rejects.toThrow(/key of your endpoint/);
  });

  it('changes only the fields typed for the custom endpoint', async () => {
    const kv = memoryKV();
    await saveLlmConfig(kv, CUSTOM);
    await saveLlmConfig(kv, { mode: 'custom', model: 'other-model' });
    expect((await loadLlmConfig(kv))?.custom).toEqual({ apiKey: 'ck', baseUrl: 'https://llm.example.com/v1', model: 'other-model' });
  });

  it('never exposes a key, and the fallback is on by default', async () => {
    const kv = memoryKV();
    await saveLlmConfig(kv, CUSTOM);
    await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'secret-g' });
    const s = await llmStatus(kv);
    expect(JSON.stringify(s)).not.toMatch(/secret-g|"ck"/);
    expect(s.fallback).toBe(true);
    expect((await setLlmFallback(kv, false)).fallback).toBe(false);
    expect((await saveLlmConfig(kv, { mode: 'gemini' })).fallback).toBe(false); // saving does not reset it
    await expect(setLlmFallback(memoryKV(), true)).rejects.toThrow(/key/);
  });

  it('removes one provider, the other becomes the primary; removing the last clears everything', async () => {
    const kv = memoryKV();
    await saveLlmConfig(kv, CUSTOM);
    await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'gk' });
    let s = await clearLlmConfig(kv, 'gemini');
    expect(s).toMatchObject({ configured: true, mode: 'custom', gemini: { configured: false } });
    s = await clearLlmConfig(kv, 'custom');
    expect(s.configured).toBe(false);
    expect(await kv.get('rg:llm')).toBeUndefined();
  });

  it('converts the first stored format', async () => {
    const kv = memoryKV();
    await kv.set('rg:llm', { mode: 'custom', apiKey: 'ck', baseUrl: 'https://llm.example.com/v1', model: 'my-model', auto: false });
    expect(await llmStatus(kv)).toMatchObject({ configured: true, mode: 'custom', auto: false, custom: { configured: true, model: 'my-model' }, gemini: { configured: false } });
    await kv.set('rg:llm', { mode: 'gemini', apiKey: 'gk' });
    expect(await llmStatus(kv)).toMatchObject({ mode: 'gemini', gemini: { configured: true } });
  });
});

describe('fallback between providers', () => {
  const both = async (primary: 'gemini' | 'custom') => {
    const kv = memoryKV();
    await saveLlmConfig(kv, CUSTOM);
    await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'gk' });
    if (primary === 'custom') await saveLlmConfig(kv, { mode: 'custom' });
    return kv;
  };

  it('uses the primary when it works and never touches the other', async () => {
    const f = fakeFetch(gemini({}, 'from-gemini'), customRoute(200, 'from-custom'));
    const r = await askLlm({ fetch: f.fetch, kv: await both('gemini') }, 'hi');
    expect(r).toMatchObject({ text: 'from-gemini', provider: 'gemini', fallback: false });
    expect(f.calls.some((c) => c.url.includes('llm.example.com'))).toBe(false);
  });

  it('falls back to the custom endpoint when Gemini fails', async () => {
    const f = fakeFetch(gemini(GEMINI_DOWN), customRoute(200, 'from-custom'));
    const r = await askLlm({ fetch: f.fetch, kv: await both('gemini') }, 'hi');
    expect(r).toMatchObject({ text: 'from-custom', model: 'my-model', provider: 'custom', fallback: true });
  });

  it('falls back to Gemini when the custom primary fails', async () => {
    const f = fakeFetch(gemini({}, 'from-gemini'), customRoute(503));
    const r = await askLlm({ fetch: f.fetch, kv: await both('custom') }, 'hi');
    expect(r).toMatchObject({ text: 'from-gemini', provider: 'gemini', fallback: true });
  });

  it('does not fall back when turned off', async () => {
    const kv = await both('gemini');
    await setLlmFallback(kv, false);
    const f = fakeFetch(gemini(GEMINI_DOWN), customRoute(200));
    await expect(askLlm({ fetch: f.fetch, kv }, 'hi')).rejects.toThrow(/No Gemini model answered/);
    expect(f.calls.some((c) => c.url.includes('llm.example.com'))).toBe(false);
  });

  it('lists both errors when neither answers', async () => {
    const f = fakeFetch(gemini(GEMINI_DOWN), customRoute(503));
    await expect(askLlm({ fetch: f.fetch, kv: await both('gemini') }, 'hi')).rejects.toThrow(/Gemini: No Gemini model answered.* \| Custom endpoint: .*custom down/);
  });

  it('asks a single provider on its own with "only" (the Test button)', async () => {
    const f = fakeFetch(gemini(GEMINI_DOWN), customRoute(200));
    const kv = await both('gemini');
    await expect(askLlm({ fetch: f.fetch, kv, only: 'gemini' }, 'hi')).rejects.toThrow(/No Gemini model answered/);
    expect((await askLlm({ fetch: f.fetch, kv, only: 'custom' }, 'hi')).provider).toBe('custom');
    await expect(askLlm({ fetch: f.fetch, kv: await ready(), only: 'custom' }, 'hi')).rejects.toThrow(/not set up/);
  });

  it('skips a provider the browser has not allowed and uses the other', async () => {
    const f = fakeFetch(gemini({}, 'from-gemini'), customRoute(200, 'from-custom'));
    const kv = await both('custom');
    const r = await askLlm({ fetch: f.fetch, kv, canUse: async (origin) => !origin.includes('llm.example.com') }, 'hi');
    expect(r).toMatchObject({ provider: 'gemini', fallback: true });
    expect(f.calls.some((c) => c.url.includes('llm.example.com'))).toBe(false);
  });

  it('tells the page the fallback answered, through the handler (and caches that answer)', async () => {
    const yml = 'groups:\n  - name: infra\n    description: "Servers."\n';
    const file: Route = (u) => (u.pathname === '/repos/o/.github/contents/repo-groups.yml' ? { json: { content: btoa(yml), sha: 'a' } } : undefined);
    const f = fakeFetch(file, gemini(GEMINI_DOWN), customRoute(200, 'infra'));
    const kv = await both('gemini');
    const handle = createHandler({ fetch: f.fetch, kv, index: memoryIndexStore() });
    const r: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'zzz' }, method: 'llm' });
    expect(r.data).toMatchObject({ source: 'llm', key: 'infra', model: 'my-model', fallback: true });
    const aiCalls = () => f.calls.filter((c) => /generativelanguage|llm\.example\.com/.test(c.url)).length;
    const before = aiCalls();
    const again: any = await handle({ type: 'suggest:group', org: 'o', repo: { name: 'zzz' }, method: 'llm' });
    expect(again.data).toMatchObject({ key: 'infra', fallback: true });
    expect(aiCalls()).toBe(before); // answered from the cache
  });

  it('tests one provider through the handler, and reports which one worked', async () => {
    const f = fakeFetch(gemini(GEMINI_DOWN), customRoute(200));
    const handle = createHandler({ fetch: f.fetch, kv: await both('gemini'), index: memoryIndexStore() });
    const bad: any = await handle({ type: 'llm:test', mode: 'gemini' });
    expect(bad.ok).toBe(false);
    const good: any = await handle({ type: 'llm:test', mode: 'custom' });
    expect(good).toMatchObject({ ok: true, data: { provider: 'custom', model: 'my-model' } });
  });
});

describe('changing the AI setup does not serve answers from the old one', () => {
  const yml = 'groups:\n  - name: infra\n    description: "Servers."\n';
  const file: Route = (u) => (u.pathname === '/repos/o/.github/contents/repo-groups.yml' ? { json: { content: btoa(yml), sha: 'a' } } : undefined);
  const setup = async () => {
    const f = fakeFetch(file, gemini({}, 'infra'), customRoute(200, 'infra'));
    const kv = memoryKV();
    await saveLlmConfig(kv, CUSTOM);
    await saveLlmConfig(kv, { mode: 'gemini', apiKey: 'gk' });
    await saveLlmConfig(kv, { mode: 'custom' }); // custom first, as in the report
    const handle = createHandler({ fetch: f.fetch, kv, index: memoryIndexStore() });
    const ask = async () => ((await handle({ type: 'suggest:group', org: 'o', repo: { name: 'seaweedfs' }, method: 'llm' })) as any).data;
    const ai = (host: RegExp) => f.calls.filter((c) => host.test(c.url)).length;
    return { f, kv, handle, ask, ai };
  };

  it('after making Gemini the primary, the next answer comes from Gemini, not from the cache', async () => {
    const { handle, ask, ai } = await setup();
    expect(await ask()).toMatchObject({ provider: 'custom', model: 'my-model', fallback: false });
    expect(await ask()).toMatchObject({ provider: 'custom' }); // cached while nothing changed
    expect(ai(/generativelanguage/)).toBe(0);

    await handle({ type: 'llm:save', config: { mode: 'gemini' } });
    const r = await ask();
    expect(r).toMatchObject({ provider: 'gemini', fallback: false });
    expect(r.model).toMatch(/gemini/);
    expect(ai(/generativelanguage/)).toBeGreaterThan(0);
  });

  it('even if the settings were changed some other way, the cache key follows the setup', async () => {
    const { kv, ask, ai } = await setup();
    await ask();
    // primary switched directly in storage (no llm:save): the old answer must not be served
    const c: any = await kv.get('rg:llm');
    await kv.set('rg:llm', { ...c, primary: 'gemini' });
    expect(await ask()).toMatchObject({ provider: 'gemini' });
    expect(ai(/generativelanguage/)).toBeGreaterThan(0);
  });

  it('turning the fallback off or removing a provider also starts clean', async () => {
    const { handle, ask, ai } = await setup();
    await ask();
    await handle({ type: 'llm:fallback', fallback: false });
    const before = ai(/llm\.example\.com/);
    await ask();
    expect(ai(/llm\.example\.com/)).toBe(before + 1);
    await handle({ type: 'llm:clear', mode: 'custom' });
    expect(await ask()).toMatchObject({ provider: 'gemini' });
  });

  it('a new save also lifts the automatic pause', async () => {
    const { kv, handle } = await setup();
    await kv.set('rg:llm:pause', Date.now() + 10 * 60_000);
    await handle({ type: 'llm:save', config: { mode: 'gemini' } });
    expect(await kv.get('rg:llm:pause')).toBeUndefined();
  });
});

