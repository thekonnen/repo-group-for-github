import { groupStats, WEEKS } from '../../core/group-stats';
import type { GroupNode } from '../../core/tree';
import { t } from '../../i18n';

/** Aggregate summary under the stats row: language mix and repos-last-pushed-per-week (F1/C6). Recursive, from the index only. */
export function GroupSummary({ node }: { node: GroupNode }) {
  const s = groupStats(node);
  if (!s.repos) return null;
  const langs = s.languages.length ? s.languages.map((l) => `${l.name} ${l.percent}%`).join(', ') : t('summaryNoLanguages');
  const alt = t('summaryAltText', String(s.repos), String(s.stars), String(s.forks), langs, String(s.pushed30d), s.weekly.join(', '));
  const max = Math.max(1, ...s.weekly);
  const bw = 6;
  const gap = 2;
  const h = 24;
  return (
    <section class="rg-summary" aria-label={t('summaryLanguages')}>
      <p class="rg-sr-only">{alt}</p>
      {s.languages.length > 0 && (
        <div class="rg-lang" aria-hidden="true">
          <div class="rg-lang-bar">
            {s.languages.map((l) => (
              <span key={l.name} style={`flex:${l.repos} 1 0;background:${l.color}`} title={`${l.name}: ${l.percent}% (${l.repos})`} />
            ))}
          </div>
          <ul class="rg-lang-legend">
            {s.languages.map((l) => (
              <li key={l.name} title={`${l.repos} ${l.repos === 1 ? 'repository' : 'repositories'}`}>
                <i style={`background:${l.color}`} />{l.name} <span class="rg-muted">{l.percent}%</span>
              </li>
            ))}
          </ul>
          <span class="rg-muted rg-lang-note">{t('summaryLanguagesNote')}{s.noLanguage ? ` · ${t('summaryNoLanguage', String(s.noLanguage))}` : ''}</span>
        </div>
      )}
      <div class="rg-spark" aria-hidden="true">
        <svg width={WEEKS * (bw + gap) - gap} height={h} viewBox={`0 0 ${WEEKS * (bw + gap) - gap} ${h}`}>
          <title>{t('summarySparkNote')}</title>
          {s.weekly.map((n, i) => {
            const bh = n ? Math.max(2, Math.round((n / max) * h)) : 1;
            return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx="1" fill="currentColor" opacity={n ? 1 : 0.3}><title>{n}</title></rect>;
          })}
        </svg>
        <span class="rg-muted rg-spark-label">{t('summarySparkTitle')}</span>
      </div>
    </section>
  );
}
