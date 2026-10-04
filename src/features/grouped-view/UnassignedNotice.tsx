import { t } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { useStore } from '../store';
import type { Controller } from './controller';

/** "12 repositories are not in any group yet" (A6). In the personal layer the wording is "Not in My groups". */
export function unassignedText(count: number, personal = false): string {
  if (personal) return count === 1 ? t('unassignedNoticeOneMy') : t('unassignedNoticeManyMy', count.toLocaleString());
  return count === 1 ? t('unassignedNoticeOne') : t('unassignedNoticeMany', count.toLocaleString());
}

export const ungroupedTabLabel = (personal = false): string => t(personal ? 'tabUngroupedMy' : 'tabUngrouped');

/** Callout above the list on the root. Nothing at all when every repository is in a group. */
export function UnassignedNotice({ ctl, count, newCount, personal = false }: { ctl: Controller; count: number; newCount: number; personal?: boolean }) {
  const s = useStore(ctl.store);
  if (!count || s.unassignedDismissed) return null;
  return (
    <div class="rg-banner rg-unassigned" role="status">
      <span class="rg-grow">
        <b>{unassignedText(count, personal)}</b>
        {newCount > 0 && <span class="rg-muted"> · {t('unassignedNewCount', newCount.toLocaleString())}</span>}
      </span>
      <button type="button" class="rg-btn" onClick={() => ctl.reviewUngrouped()}>{t(personal ? 'unassignedReviewMy' : 'unassignedReview')}</button>
      <button type="button" class="rg-btn" onClick={() => ctl.openYaml(undefined, 'ungrouped')}><Icon name="sparkle" />{t('unassignedStartAi')}</button>
      <button type="button" class="rg-btn rg-unassigned-x" aria-label={t('unassignedDismiss')} title={t('unassignedDismiss')} onClick={() => ctl.dismissUnassigned()}><Icon name="x" /></button>
    </div>
  );
}

/** Small count badge in the sidebar; click reviews the ungrouped repositories. */
export function UnassignedBadge({ ctl, count, personal = false }: { ctl: Controller; count: number; personal?: boolean }) {
  if (!count) return null;
  const text = unassignedText(count, personal);
  return (
    <button type="button" class="rg-unassigned-badge" title={text} aria-label={text} onClick={() => ctl.reviewUngrouped()}>
      <Icon name="alert" size={12} />{count.toLocaleString()}
    </button>
  );
}
