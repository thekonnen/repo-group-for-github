import { GitHubError, type Client } from './api';

/** POST https://api.github.com/graphql through the shared client (token, rate state, error mapping). */
export async function graphql<T = any>(client: Client, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await client.rest<{ data?: T; errors?: { type?: string; message?: string }[] }>('/graphql', { method: 'POST', body: { query, variables } });
  const body = res.data;
  // Aliases for repositories the user cannot open come back as null with NOT_FOUND errors: that is data, not a failure.
  if (!body || !body.data) {
    const e = body?.errors?.[0];
    if (e?.type === 'RATE_LIMITED') throw new GitHubError(403, 'rate-limit', e.message ?? 'GraphQL rate limit exceeded', { resetAt: client.rate.resetAt ?? undefined });
    throw new GitHubError(200, 'other', e?.message ?? 'GitHub returned an empty GraphQL answer.');
  }
  return body.data;
}

/** `query($o: String!, $n0: String!, …) { r0: repository(owner: $o, name: $n0) { <fields> } … }` for up to 50 names. */
export function aliasQuery(names: string[], fields: string): { query: string; variables: Record<string, string> } {
  const vars: Record<string, string> = {};
  const decl = ['$o: String!'];
  const body: string[] = [];
  names.forEach((n, i) => {
    vars[`n${i}`] = n;
    decl.push(`$n${i}: String!`);
    body.push(`r${i}: repository(owner: $o, name: $n${i}) { ${fields} }`);
  });
  return { query: `query(${decl.join(', ')}) { ${body.join(' ')} }`, variables: vars };
}
