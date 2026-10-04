import { describe, expect, it } from 'vitest';
import { parseSearch, searchPrompt } from '../src/background/llm';

describe('AI search', () => {
  const names = ['dagsrv', 'billing-api', 'authn'];
  it('keeps only real repository names, once each', () => {
    expect(parseSearch('{"names":["billing-api","nope","billing-api","authn"]}', names)).toEqual(['billing-api', 'authn']);
  });
  it('accepts a json fence and rejects anything else', () => {
    expect(parseSearch('```json\n{"names":["dagsrv"]}\n```', names)).toEqual(['dagsrv']);
    expect(parseSearch('dagsrv and authn', names)).toBeNull();
    expect(parseSearch('{"names":"dagsrv"}', names)).toBeNull();
  });
  it('fences repositories and the search as data', () => {
    const p = searchPrompt([{ name: 'dagsrv', description: 'DAG server' }], 'pagamentos');
    expect(p).toContain('<data kind="repositories">\ndagsrv | - | DAG server\n</data>');
    expect(p).toContain('<data kind="search">\npagamentos\n</data>');
  });
});

import { groupText } from '../src/core/tree';

describe('group text in search', () => {
  it('reads name, description, keywords and an inline README; a README file only once loaded', () => {
    const g = { name: 'infra', description: 'Servers', keywords: ['s3'], readme: 'Backups live in object storage', groups: [] } as any;
    expect(groupText(g, {})).toContain('object storage');
    const f = { ...g, readme: 'readmes/infra.md' };
    expect(groupText(f, {})).not.toContain('object storage');
    expect(groupText(f, { 'readmes/infra.md': 'Backups live in object storage' })).toContain('object storage');
  });
});
