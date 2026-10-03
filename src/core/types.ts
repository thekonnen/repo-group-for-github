export type Permission = 'pull' | 'triage' | 'push' | 'maintain' | 'admin' | (string & {});

export interface TeamTag {
  slug: string;
  permission: Permission;
}

export interface Group {
  name: string;
  description: string;
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
  viewerIsAdmin?: boolean;
}
