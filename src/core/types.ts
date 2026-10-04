export type Permission = 'pull' | 'triage' | 'push' | 'maintain' | 'admin' | (string & {});

export interface TeamTag {
  slug: string;
  permission: Permission;
}

export interface Group {
  /** The slug: URL, rules, paths. Lowercase letters, numbers, - _ . */
  name: string;
  /** Optional display name (capitals, spaces, accents). Shown instead of `name` when present. */
  title?: string;
  description: string;
  /** Optional words that describe what belongs here (tools, topics). Only used to suggest a group for a new repo. */
  keywords?: string[];
  logo: string | null;
  /** Optional presentation page (C4): a path inside <org>/.github (`readmes/infra.md`) or inline Markdown. */
  readme?: string;
  teams: TeamTag[];
  match: string[];
  groups: Group[];
}

/** Parsed repo-groups.yml. `root` is a virtual group holding the top-level groups. */
export interface Config {
  version: number;
  index: 'api' | 'action';
  groups: Group[];
}

export interface RepoInfo {
  name: string;
  description?: string;
  language?: string | null;
  languageColor?: string | null;
  private?: boolean;
  archived?: boolean;
  fork?: boolean;
  pushedAt?: string | null;
  stars?: number;
  forks?: number;
  openIssuesAndPrs?: number;
  viewerIsAdmin?: boolean;
}
