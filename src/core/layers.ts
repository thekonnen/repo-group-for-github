export type Layer = 'org' | 'my';

export interface Route {
  layer: Layer;
  path: string[];
}

/** `#infra/dagsrv` -> org layer; `#~my/infra/dagsrv` -> personal layer. */
export function parseHash(hash: string): Route {
  const raw = decodeURIComponent(hash.replace(/^#/, ''));
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === '~my') return { layer: 'my', path: parts.slice(1) };
  return { layer: 'org', path: parts };
}

export function buildHash(route: Route): string {
  const parts = route.layer === 'my' ? ['~my', ...route.path] : route.path;
  return parts.length ? '#' + parts.map(encodeURIComponent).join('/') : '';
}
