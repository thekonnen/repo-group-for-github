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
  /** GitHub topics, lowercase. Matched by `topic:` rules. */
  topics?: string[];
  viewerIsAdmin?: boolean;
  /** Org custom property values, joined in by the background worker (never stored in the index). */
  props?: Record<string, string | string[]>;
}
