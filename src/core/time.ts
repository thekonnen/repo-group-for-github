const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'No pushes';
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return rtf.format(-mins, 'minute');
  if (mins < 1440) return rtf.format(-Math.round(mins / 60), 'hour');
  if (mins < 43200) return rtf.format(-Math.round(mins / 1440), 'day');
  if (mins < 525600) return rtf.format(-Math.round(mins / 43200), 'month');
  return rtf.format(-Math.round(mins / 525600), 'year');
}
