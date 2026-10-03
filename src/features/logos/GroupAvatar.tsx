import { Avatar } from '../../ui/Avatar';
import { useLogoSrc, type LogoStore } from './logo-store';

/** Avatar of a group with its logo (looked up in the logo store), falling back to the letter. Reusable wherever groups show. */
export function GroupAvatar({ logos, name, logo, cls, root }: { logos: LogoStore; name: string; logo?: string | null; cls: string; root?: boolean }) {
  return <Avatar name={name} cls={cls} root={root} logo={useLogoSrc(logos, logo)} />;
}
