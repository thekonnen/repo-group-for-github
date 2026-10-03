/** REST does not return language colors; GitHub's own for the common ones, grey otherwise. */
const COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572a5', Go: '#00add8', Rust: '#dea584', Java: '#b07219',
  'C#': '#178600', 'C++': '#f34b7d', C: '#555555', Ruby: '#701516', PHP: '#4f5d95', Shell: '#89e051',
  Dockerfile: '#384d54', HTML: '#e34c26', CSS: '#563d7c', Swift: '#f05138', Kotlin: '#a97bff', Dart: '#00b4ab',
  Vue: '#41b883', PLpgSQL: '#336790', HCL: '#844fba', Makefile: '#427819', Lua: '#000080', Nix: '#7e7eff',
};
export const langColor = (lang: string | null | undefined, given?: string | null): string => given || (lang && COLORS[lang]) || '#8b949e';
