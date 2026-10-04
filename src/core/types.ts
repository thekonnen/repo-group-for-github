export type Permission = 'pull' | 'triage' | 'push' | 'maintain' | 'admin' | (string & {});

export interface TeamTag {
  slug: string;
  permission: Permission;
}

/** Order of a group's repositories (C5). Absent = Last pushed. */
export type GroupSort = 'pushed' | 'name' | 'stars' | 'issues';
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
  /** Optional presentation page (C4): a path inside <org>/.github (`readmes/infra.md`) or inline Markdown. */
  readme?: string;
  teams: TeamTag[];
  /** Default labels (C2). Inherited by subgroups; the closest definition of a name wins. */
  labels?: LabelTag[];
  /** Default milestones (C2). Same inheritance as labels. */
  milestones?: MilestoneTag[];
  match: string[];
  /** Exact repo names shown first, in this order, in the group's repo list (C5). Only repos placed in the group count. */
  pinned?: string[];
  /** Default order of the group's repos (C5). Absent = Last pushed. */
  sort?: GroupSort;
  /**
   * Optional (A3). Rules that ALSO list a repository in this group, on top of its primary placement. They never change
   * where a repo is placed (ungrouped detection, team access and counts of "grouped" use the primary placement only).
   */
  shared?: string[];
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
  /** Upstream of a fork as "owner/repo" (A5). Filled lazily from GraphQL; null = looked up, none. */
  parent?: string | null;
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
