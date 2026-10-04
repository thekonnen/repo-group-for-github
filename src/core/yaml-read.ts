import { configFromObject, type ValidateOptions, type ValidationResult } from './validate';

/** First fenced block (```yaml / ```yml / ```), or the text itself. */
export function stripFences(text: string): { text: string; stripped: boolean } {
  const m = text.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/i);
  // A file that already has its top-level keys before the fence is plain YAML: the fence is inside a README text (C4).
  if (m && m.index !== undefined && /^(?:version|groups|index)[ \t]*:/m.test(text.slice(0, m.index))) return { text, stripped: false };
  return m ? { text: m[1], stripped: true } : { text, stripped: false };
}

export interface ReadResult extends ValidationResult {
  stripped?: boolean;
}

type Loader = (text: string) => unknown;

/** Lazy-loads js-yaml; only the YAML editor and config reads pay for it. */
export async function loadYamlParser(): Promise<Loader> {
  const mod = await import('js-yaml');
  return (t) => mod.load(t);
}

export function readConfig(text: string, load: Loader, opts: ValidateOptions = {}): ReadResult {
  const f = stripFences(text);
  let obj: unknown;
  try {
    obj = load(f.text);
  } catch (e: any) {
    const line = e?.mark ? e.mark.line + 1 : null;
    return { error: `${e?.reason || 'Invalid YAML'}${line ? ` (line ${line})` : ''}`, line, warnings: [] };
  }
  // `repositories:` and unknown keys are ignored by configFromObject.
  return { ...configFromObject(obj, opts), stripped: f.stripped };
}
