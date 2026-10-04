import { isReadmePath } from '../../core/readme';
import { Markdown } from './Markdown';
import { useReadmeText, type ReadmeStore } from './readme-store';

/** "About" tab of a group page (C4): its README, from inline text or from a file in <org>/.github. */
export function AboutPanel({ org, readmes, readme }: { org: string; readmes: ReadmeStore; readme: string }) {
  const path = isReadmePath(readme) ? readme.trim() : '';
  const loaded = useReadmeText(readmes, path);
  const text = path ? loaded : readme;
  return (
    <div class="rg-box" role="tabpanel" aria-label="About">
      <div class="rg-box-head"><span>About</span>{path && <span class="rg-muted"><code>{org}/.github/{path}</code></span>}</div>
      <div class="rg-about">
        {text === undefined ? (
          <div class="rg-muted" role="status">Loading the README…</div>
        ) : text === null ? (
          <div class="rg-muted" role="status">This README could not be loaded. Check that <code>{path}</code> exists in <code>{org}/.github</code> and is smaller than 64 KB.</div>
        ) : (
          <Markdown text={text} />
        )}
      </div>
    </div>
  );
}
