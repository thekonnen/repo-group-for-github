import { ICON } from './icons';

export function Icon({ name, size = 16 }: { name: keyof typeof ICON; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[name] }} />;
}
