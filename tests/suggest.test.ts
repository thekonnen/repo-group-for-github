import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { suggest, tokens } from '../src/core/suggest';
import { readConfig } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';

const groups = readConfig(readFileSync(new URL('./fixtures/acme-groups.yml', import.meta.url), 'utf8'), (t) => yaml.load(t), { org: 'thekonnen' }).config!.groups;
const run = (name: string, description = '') => suggest(groups, { name, description });

describe('suggest', () => {
  it('tokenizes names and text', () => {
    expect(tokens('kite-Billing_api.v2')).toEqual(['kite', 'billing', 'api', 'v2']);
    expect(tokens('Servidores de logs')).toEqual(['servidore', 'log']);
  });

  it('uses the placement rules first (exact name, then glob)', () => {
    expect(run('kite-storage')).toMatchObject({ source: 'rule', key: 'infra/cloud', rule: 'kite-storage' });
    expect(run('lp-black-friday')).toMatchObject({ source: 'rule', key: 'kite-websites-landpages', rule: 'lp-*' });
  });

  it('does not know a tool name by itself: minio alone is left to the AI', () => {
    expect(run('minio')).toMatchObject({ source: 'uncertain', key: null });
  });

  it('uses the keywords the org wrote for a group', () => {
    const withKeywords = structuredClone(groups);
    withKeywords.find((g) => g.name === 'infra')!.groups.find((g) => g.name === 'cloud')!.keywords = ['s3', 'object storage', 'bucket'];
    expect(suggest(withKeywords, { name: 'minio', description: 's3 autohospedado' })).toMatchObject({ source: 'lexical', key: 'infra/cloud' });
    // the same input without keywords is not enough
    expect(run('minio', 's3 autohospedado').source).toBe('uncertain');
  });

  it('classifies by description when the name says little', () => {
    expect(run('metrics-dashboards', 'dashboards e alertas').key).toBe('infra/monitoring');
  });

  it('says uncertain instead of guessing', () => {
    const r = run('xyz');
    expect(r.source).toBe('uncertain');
    expect(r.key).toBeNull();
    expect(r.ranking.length).toBeGreaterThan(0);
  });

  it('follows the group that literally names the term', () => {
    // "LLM" is only written in the llm-gateway title; nothing in the config ties it to ai-tools
    const r = run('ai-projeto', 'projeto de LLM');
    expect(r).toMatchObject({ source: 'lexical', key: 'platform-services/llm-gateway' });
  });

  it('handles an empty config', () => {
    expect(suggest([], { name: 'x' })).toMatchObject({ source: 'uncertain', key: null });
  });
});

describe('keywords in repo-groups.yml', () => {
  const parse = (text: string) => readConfig(text, (t) => yaml.load(t), { org: 'o' });
  const text = 'groups:\n  - name: infra\n    keywords: ["s3", "backup"]\n';

  it('reads them, as a list or a single word', () => {
    expect(parse(text).config!.groups[0].keywords).toEqual(['s3', 'backup']);
    expect(parse('groups:\n  - name: a\n    keywords: s3\n').config!.groups[0].keywords).toEqual(['s3']);
    expect(parse('groups:\n  - name: a\n').config!.groups[0].keywords).toBeUndefined();
  });

  it('rejects something that is not a list of words', () => {
    expect(parse('groups:\n  - name: a\n    keywords: [1, 2]\n').error).toBe('"a": keywords must be a list of words.');
  });

  it('keeps them when the extension writes the file back', () => {
    const out = writeConfig(parse(text).config!, 'o/.github/repo-groups.yml');
    expect(out).toContain('keywords: ["s3", "backup"]');
    expect(parse(out).config!.groups[0].keywords).toEqual(['s3', 'backup']);
  });
});
