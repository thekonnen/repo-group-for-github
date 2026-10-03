import { describe, expect, it } from 'vitest';
import { createHandler } from '../src/background/handlers';
import { memoryKV } from '../src/background/kv';
import { askLlm, classifyPrompt, llmOrigin, llmStatus, modelRank, orderModels, parseChoice, parseNewGroup, saveLlmConfig, setLlmAuto } from '../src/background/llm';
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
    expect(r).toEqual({ text: 'OK', model: 'gemini-2.5-flash-lite' });
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
    expect(await askLlm({ fetch: f.fetch, kv }, 'hi')).toEqual({ text: 'hello', model: 'my-model' });
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
