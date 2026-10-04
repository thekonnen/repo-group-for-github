import { useRef } from 'preact/hooks';
import { groupStats } from '../../core/group-stats';
import type { GroupNode } from '../../core/tree';
import { t } from '../../i18n';

const SW = 120;
const SH = 25;
const SPAD = 2;
let seq = 0;
/** Unique ids per instance: several summaries can be mounted at once and url(#id) references are document-wide. */
function useId() { return useRef(`rg-spark-${++seq}`).current; }

/** Aggregate summary under the stats row: language mix and repos-last-pushed-per-week (F1/C6). Recursive, from the index only. */
export function GroupSummary({ node }: { node: GroupNode }) {
  const s = groupStats(node);
  if (!s.repos) return null;
  const langs = s.languages.length ? s.languages.map((l) => `${l.name} ${l.percent}%`).join(', ') : t('summaryNoLanguages');
  const alt = t('summaryAltText', String(s.repos), String(s.stars), String(s.forks), langs, String(s.pushed30d), s.weekly.join(', '));
  const max = Math.max(1, ...s.weekly);
  const uid = useId();
  const step = SW / Math.max(1, s.weekly.length - 1);
  const points = s.weekly.map((n, i) => `${(i * step).toFixed(1)},${(SPAD + (1 - n / max) * (SH - 2 * SPAD)).toFixed(1)}`).join(' ');
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
        <svg width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`}>
          <title>{t('summarySparkNote')}</title>
          <defs>
            <linearGradient id={`${uid}-g`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stop-color="currentColor" stop-opacity="0.25" />
              <stop offset="1" stop-color="currentColor" />
            </linearGradient>
            <mask id={`${uid}-m`}>
              <polyline points={points} fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </mask>
          </defs>
          <rect x="0" y="0" width={SW} height={SH} style={`stroke:none;fill:url(#${uid}-g);mask:url(#${uid}-m)`} />
          {s.weekly.map((n, i) => <rect key={i} x={i * step - step / 2} y="0" width={step} height={SH} fill="transparent"><title>{n}</title></rect>)}
        </svg>
        <span class="rg-muted rg-spark-label">{t('summarySparkTitle')}</span>
      </div>
    </section>
  );
}
