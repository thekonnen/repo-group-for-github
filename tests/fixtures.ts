import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { readConfig } from '../src/core/yaml-read';
import type { Config, RepoInfo } from '../src/core/types';

export const load = (t: string) => yaml.load(t);
export const EXAMPLE = readFileSync(join(process.cwd(), 'design/repo-groups.example.yml'), 'utf8');
export const example = (): Config => readConfig(EXAMPLE, load, { org: 'thekonnen' }).config!;

export const REPOS: RepoInfo[] = [
  'konnen-litellm', 'litellm', 'konnen-authentik', 'konnen-checkmate', 'authentik',
  'konnen-dagu', 'dagu', 'keep_supabase_alive', 'omniroute', 'dags-repo',
].map((name) => ({ name }));
