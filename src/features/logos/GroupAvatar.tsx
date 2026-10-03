import { Avatar } from '../../ui/Avatar';
import { useLogoSrc, type LogoStore } from './logo-store';

/**
 * Avatar of a group with its logo (looked up in the logo store), falling back to the letter. `name` is the slug (it
 * sets the tone), `label` the display name (it gives the letter). Reusable wherever groups show.
 */
export function GroupAvatar({ logos, name, label, logo, cls, root }: { logos: LogoStore; name: string; label?: string; logo?: string | null; cls: string; root?: boolean }) {
  return <Avatar name={name} label={label} cls={cls} root={root} logo={useLogoSrc(logos, logo)} />;
}
