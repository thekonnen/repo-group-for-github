export type Permission = 'pull' | 'triage' | 'push' | 'maintain' | 'admin' | (string & {});

export interface TeamTag {
  slug: string;
  permission: Permission;
}

/** A default issue label of a group (C2). `color` is 6 hex digits without "#"; absent = the default color. */
export interface LabelTag {
  name: string;
  color?: string;
  description?: string;
}

/** A default milestone of a group (C2). `due_on` is a date (YYYY-MM-DD) or an ISO 8601 timestamp. */
export interface MilestoneTag {
  title: string;
  due_on?: string;
  description?: string;
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
  /** Default labels (C2). Inherited by subgroups; the closest definition of a name wins. */
  labels?: LabelTag[];
  /** Default milestones (C2). Same inheritance as labels. */
  milestones?: MilestoneTag[];
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
