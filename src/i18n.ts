import { browser } from 'wxt/browser';
import en from '../public/_locales/en/messages.json';

type Entry = { message: string; placeholders?: Record<string, { content: string }> };
const messages = en as Record<string, Entry>;
export type MessageKey = keyof typeof en;

/** English text from _locales/en with placeholders ($NAME$ -> $1..$9) filled in. Used when the browser has no answer. */
export function englishMessage(key: string, subs: string[] = []): string {
  const e = messages[key];
  if (!e) return key;
  let text = e.message;
  for (const [name, p] of Object.entries(e.placeholders ?? {})) {
    const idx = Number(/^\$(\d)$/.exec(p.content)?.[1] ?? 0) - 1;
    text = text.replace(new RegExp(`\\$${name}\\$`, 'gi'), subs[idx] ?? '');
  }
  return text;
}

/** i18n lookup with a fallback to the English text, so a missing locale never shows a blank label. */
export function t(key: MessageKey, ...subs: string[]): string {
  try {
    const got: string | undefined = (browser.i18n as any)?.getMessage(key, subs);
    if (got) return got;
  } catch {}
  return englishMessage(key as string, subs);
}
