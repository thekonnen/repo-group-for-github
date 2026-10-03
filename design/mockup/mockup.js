// Prototype logic for the Repository Group for Github mockup.
// Reference only: port the pure functions to TypeScript; do not ship this file.
(function () {
  var ORG = 'thekonnen';
  var ICON = {
    repo: '<path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/>',
    folder: '<path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/>',
    chev: '<path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>',
    search: '<path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>',
    star: '<path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"/>',
    fork: '<path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/>',
    issue: '<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/>',
    pr: '<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>',
    pencil: '<path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.249.249 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"/>',
    plus: '<path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/>',
    x: '<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>',
    list: '<path d="M2 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm3.75-1.5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Zm0 5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Zm0 5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5ZM3 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-1 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/>',
    code: '<path d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z"/>',
    copy: '<path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>',
    alert: '<path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>',
    image: '<path d="M16 13.25A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75ZM1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h.94l.03-.03 6.077-6.078a1.75 1.75 0 0 1 2.412-.06L14.5 10.31V2.75a.25.25 0 0 0-.25-.25Zm12.5 11a.25.25 0 0 0 .25-.25v-.917l-4.298-3.889a.25.25 0 0 0-.344.009L4.81 13.5ZM7 6a2 2 0 1 1-3.999.001A2 2 0 0 1 7 6ZM5.5 6a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0Z"/>',
    link: '<path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"/>',
    zoomout: '<path d="M2.75 7.25h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5Z"/>',
    sparkle: '<path d="M7.53 1.282a.5.5 0 0 1 .94 0l.478 1.306a7.492 7.492 0 0 0 4.464 4.464l1.305.478a.5.5 0 0 1 0 .94l-1.305.478a7.492 7.492 0 0 0-4.464 4.464l-.478 1.305a.5.5 0 0 1-.94 0l-.478-1.305a7.492 7.492 0 0 0-4.464-4.464L1.282 8.47a.5.5 0 0 1 0-.94l1.306-.478a7.492 7.492 0 0 0 4.464-4.464Z"/>',
    globe: '<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM5.78 8.75a9.64 9.64 0 0 0 1.363 4.177c.255.426.542.832.857 1.215.245-.296.551-.705.857-1.215A9.64 9.64 0 0 0 10.22 8.75Zm4.44-1.5a9.64 9.64 0 0 0-1.363-4.177c-.307-.51-.612-.919-.857-1.215a9.927 9.927 0 0 0-.857 1.215A9.64 9.64 0 0 0 5.78 7.25Zm-5.944 1.5H1.543a6.507 6.507 0 0 0 4.666 5.5c-.123-.181-.24-.365-.352-.552-.715-1.192-1.437-2.874-1.581-4.948Zm-2.733-1.5h2.733c.144-2.074.866-3.756 1.58-4.948.12-.197.237-.381.353-.552a6.507 6.507 0 0 0-4.666 5.5Zm10.181 1.5c-.144 2.074-.866 3.756-1.58 4.948-.12.197-.237.381-.353.552a6.507 6.507 0 0 0 4.666-5.5Zm2.733-1.5a6.507 6.507 0 0 0-4.666-5.5c.123.181.24.365.353.552.714 1.192 1.436 2.874 1.58 4.948Z"/>',
    lock: '<path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8.25 3.5h-8.5a.25.25 0 0 0-.25.25v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25ZM10.5 6V4a2.5 2.5 0 1 0-5 0v2Z"/>',
    checkcircle: '<path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z"/>',
    check: '<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>'
  };
  function svg(name, size) { size = size || 16; return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 16 16" aria-hidden="true">' + ICON[name] + '</svg>'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Uploaded logos are committed next to the YAML (logos/<group-path>.png); this map plays that folder.
  var logoFiles = {};
  function logoSrc(g) { if (!g || !g.logo) return null; return logoFiles[g.logo] || (/^https?:\/\//i.test(g.logo) ? g.logo : null); }
  function letterOf(g) { return (g === root ? ORG : g.name || '?')[0].toUpperCase(); }
  function avatar(g, cls) {
    var tone = g === root ? 'av-repo' : avClass(g.name);
    var src = logoSrc(g);
    if (src) return '<img class="' + cls + ' logo-img" src="' + esc(src) + '" alt="" data-letter="' + esc(letterOf(g)) + '" data-cls="' + cls + ' ' + tone + '">';
    return '<span class="' + cls + ' ' + tone + '">' + esc(letterOf(g)) + '</span>';
  }

  var LANG = { Dockerfile: 'var(--lang-docker)', Shell: 'var(--lang-shell)', Python: 'var(--lang-python)', PLpgSQL: 'var(--lang-plpgsql)' };

  // Repos seen in the thekonnen org (sample). "ago" is minutes since last push.
  var repos = [
    { name: 'konnen-litellm', desc: 'AI Gateway for TheKonnen', lang: null, ago: 31 },
    { name: 'litellm', desc: '', lang: 'Dockerfile', ago: 46 },
    { name: 'konnen-authentik', desc: '', lang: 'Shell', ago: 120 },
    { name: 'konnen-checkmate', desc: 'Deploy checkmate using authentik as sso login', lang: null, ago: 180 },
    { name: 'authentik', desc: '', lang: 'Python', ago: 300 },
    { name: 'konnen-dagu', desc: 'Alternative to AirFlow to run jobs and crons', lang: null, ago: 302 },
    { name: 'dagu', desc: '', lang: 'Dockerfile', ago: 360 },
    { name: 'keep_supabase_alive', desc: '*Ping the Supabase, so the project won\'t be deleted', lang: 'PLpgSQL', ago: 780 },
    { name: 'omniroute', desc: '', lang: null, ago: 900 },
    { name: 'dags-repo', desc: '', lang: null, ago: 2900 }
  ];

  // Group tree as it would live in thekonnen/.github/repo-groups.yml
  var root = { id: '', name: ORG, desc: 'All repositories, organized into groups', rules: [], children: [
    { id: 'infra', name: 'infra', desc: 'Self-hosted platform services', rules: [], children: [
      { id: 'dagu', name: 'dagu', desc: 'Jobs and crons (Airflow alternative)', rules: ['dagu', 'dags-*', 'konnen-dagu'], children: [] },
      { id: 'authentik', name: 'authentik', desc: 'SSO and identity', rules: ['*authentik*'], children: [] },
      { id: 'checkmate', name: 'checkmate', desc: 'Uptime monitoring behind authentik SSO', rules: ['*checkmate*'], children: [] }
    ] },
    { id: 'ai', name: 'ai', desc: 'LLM gateways and routing', rules: ['omniroute'], children: [
      { id: 'litellm', name: 'litellm', desc: 'LiteLLM proxy and the Konnen deployment', rules: ['*litellm*'], children: [] }
    ] }
  ] };

  var state = { path: [], view: 'grouped', tab: 'items', q: '', expanded: { 'infra': true }, drawer: null };

  // ---------- model ----------
  function link(g, parent) { g.parent = parent || null; g.children.forEach(function (c) { link(c, g); }); }
  function pathOf(g) { var p = []; while (g && g.parent) { p.unshift(g.id); g = g.parent; } return p; }
  function keyOf(g) { return pathOf(g).join('/'); }
  function find(path) { var g = root; for (var i = 0; i < path.length; i++) { g = g.children.filter(function (c) { return c.id === path[i]; })[0]; if (!g) return null; } return g; }
  function globRe(p) { return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i'); }
  function matches(rules, name) { return rules.some(function (r) { return globRe(r).test(name); }); }
  function postOrder(g, out) { g.children.forEach(function (c) { postOrder(c, out); }); if (g.parent) out.push(g); return out; }
  // Deepest group wins; repos with no matching rule stay "ungrouped" at the org root.
  // Exact names win over patterns; among patterns, the deepest group wins.
  function isExact(r) { return r.indexOf('*') < 0; }
  function pickIn(order, name) {
    var n = name.toLowerCase();
    return order.filter(function (g) { return g.rules.some(function (r) { return isExact(r) && r.toLowerCase() === n; }); })[0]
      || order.filter(function (g) { return matches(g.rules, name); })[0] || null;
  }
  function ruleFor(g, name) {
    var n = name.toLowerCase();
    return g.rules.filter(function (r) { return isExact(r) && r.toLowerCase() === n; })[0] || g.rules.filter(function (r) { return globRe(r).test(name); })[0];
  }
  function assign() {
    var order = postOrder(root, []);
    function clear(g) { g.repos = []; g.children.forEach(clear); }
    clear(root);
    repos.forEach(function (r) {
      var hit = pickIn(order, r.name);
      r.group = hit || root;
      (hit || root).repos.push(r);
    });
  }
  function allRepos(g) { var out = g.repos.slice(); g.children.forEach(function (c) { out = out.concat(allRepos(c)); }); return out; }
  function subCount(g) { return g.children.reduce(function (n, c) { return n + 1 + subCount(c); }, 0); }
  function latest(g) { var a = allRepos(g); return a.length ? Math.min.apply(null, a.map(function (r) { return r.ago; })) : null; }
  function ago(m) {
    if (m == null) return 'No pushes';
    if (m < 1) return 'just now';
    if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    if (m < 1440) { var h = Math.round(m / 60); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
    var d = Math.round(m / 1440); return d === 1 ? 'yesterday' : d + ' days ago';
  }
  function avClass(name) { var s = 0; for (var i = 0; i < name.length; i++) s += name.charCodeAt(i); return 'av' + (s % 5 + 1); }

  // ---------- render ----------
  var $main = document.getElementById('main');
  var $tree = document.getElementById('tree');
  var $url = document.getElementById('url-text');

  function render() {
    assign();
    var g = find(state.path) || root;
    if (g === root) state.path = [];
    renderUrl(g);
    renderTree(state.page === 'new' ? null : g);
    document.querySelector('.page').classList.toggle('no-side', state.page === 'new');
    $main.innerHTML = state.page === 'new' ? renderNewRepo() : state.view === 'flat' ? renderFlat() : renderGroup(g);
    if (state.page === 'new') updateNr();
    var s = document.getElementById('repo-search');
    if (s && state.focusSearch) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); state.focusSearch = false; }
  }

  function renderUrl(g) {
    if (state.page === 'new') { $url.innerHTML = '<b>github.com</b>/organizations/' + ORG + '/repositories/new'; return; }
    var hash = state.view === 'grouped' && g !== root ? '#' + keyOf(g) : '';
    $url.innerHTML = '<b>github.com</b>/orgs/' + ORG + '/repositories' + esc(hash);
  }

  function renderTree(cur) {
    var html = '';
    function item(g, depth) {
      var isCur = state.view === 'grouped' && g === cur;
      var pad = 8 + depth * 16;
      html += '<li><button type="button" class="nav-item" data-go="' + esc(keyOf(g)) + '" style="padding-left:' + pad + 'px"' + (isCur ? ' aria-current="true"' : '') + '>' +
        (g === root ? svg('repo') : logoSrc(g) ? '<img class="tree-logo" src="' + esc(logoSrc(g)) + '" alt="" data-letter="' + esc(letterOf(g)) + '" data-cls="mini-av ' + avClass(g.name) + '">' : svg('folder')) + '<span>' + esc(g === root ? 'All groups' : g.name) + '</span><span class="count">' + allRepos(g).length + '</span></button></li>';
      g.children.forEach(function (c) { item(c, depth + 1); });
    }
    item(root, 0);
    $tree.innerHTML = html;
    var all = document.getElementById('f-all');
    if (state.view === 'flat' && state.page !== 'new') all.setAttribute('aria-current', 'true'); else all.removeAttribute('aria-current');
  }

  function crumbs(g) {
    var chain = []; var x = g; while (x) { chain.unshift(x); x = x.parent; }
    return '<nav class="crumbs" aria-label="Group path">' + chain.map(function (c, i) {
      var label = c === root ? ORG : c.name;
      var av = avatar(c, 'mini-av');
      var sep = i ? '<span aria-hidden="true">/</span>' : '';
      return sep + (i === chain.length - 1 ? '<span class="cur" style="display:inline-flex;gap:6px;align-items:center">' + av + esc(label) + '</span>' : '<a href="#" data-go="' + esc(keyOf(c)) + '">' + av + esc(label) + '</a>');
    }).join('') + '</nav>';
  }

  function renderGroup(g) {
    var isRoot = g === root;
    var total = allRepos(g);
    var html = crumbs(g);
    html += '<div class="g-head"><div class="g-title">' + (isRoot ? avatar(g, 'big-av') : '<button type="button" class="big-av-btn" data-edit="' + esc(keyOf(g)) + '" data-logo-focus="1" title="Change logo" aria-label="Change logo of ' + esc(g.name) + '">' + avatar(g, 'big-av') + '<span class="pen">' + svg('pencil', 12) + '</span></button>') + '<div style="min-width:0"><h1>' + esc(isRoot ? ORG : g.name) + '</h1><p>' + esc(g.desc || '') + '</p></div></div>' +
      '<div class="g-actions">' +
      '<button type="button" class="btn" data-yaml-open="1">' + svg('code') + 'Edit YAML</button>' +
      (isRoot ? '' :'<button type="button" class="btn" data-edit="' + esc(keyOf(g)) + '">' + svg('pencil') + 'Edit group</button>') +
      '<button type="button" class="btn" data-new="' + esc(keyOf(g)) + '">' + svg('folder') + (isRoot ? 'New group' : 'New subgroup') + '</button>' +
      '<button type="button" class="btn btn-primary" data-newrepo="' + esc(keyOf(g)) + '">New repository</button></div></div>';

    html += '<div class="stats">' +
      stat('Repositories', total.length) + stat(isRoot ? 'Groups' : 'Subgroups', subCount(g)) +
      stat('Open issues', 0) + stat('Open pull requests', 0) + stat('Last push', ago(latest(g))) + '</div>';

    var ungrouped = isRoot ? root.repos.length : 0;
    var tabs = [['items', 'Groups and repositories']];
    if (isRoot) tabs.push(['ungrouped', 'Ungrouped <span class="counter">' + ungrouped + '</span>']);
    else tabs.push(['rules', 'Match rules <span class="counter">' + g.rules.length + '</span>']);
    if (!tabs.some(function (t) { return t[0] === state.tab; })) state.tab = 'items';
    html += '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" class="tab" data-tab="' + t[0] + '" aria-selected="' + (state.tab === t[0]) + '">' + t[1] + '</button>';
    }).join('') + '</div>';

    if (state.tab === 'rules') return html + rulesPanel(g);

    html += toolbar('Search in ' + (isRoot ? ORG : g.name));

    var body = '';
    var head;
    if (state.q) {
      var q = state.q.toLowerCase();
      var hits = total.filter(function (r) { return r.name.toLowerCase().indexOf(q) > -1 || r.desc.toLowerCase().indexOf(q) > -1; }).sort(byAgo);
      head = hits.length + ' result' + (hits.length === 1 ? '' : 's') + ' for “' + esc(state.q) + '”';
      body = hits.map(function (r) { return repoRow(r, 0, g); }).join('') || emptyState('No repositories match', 'Try a shorter name or clear the search.');
    } else if (state.tab === 'ungrouped') {
      var u = root.repos.slice().sort(byAgo);
      head = u.length + ' ungrouped repositor' + (u.length === 1 ? 'y' : 'ies') + ' <span class="muted">· no group rule matches these yet</span>';
      body = u.map(function (r) { return repoRow(r, 0); }).join('') || emptyState('Every repository is in a group', 'New repositories land here until a rule matches them.');
    } else {
      var items = g.children.length + (isRoot ? 0 : g.repos.length);
      head = g.children.length + ' ' + (isRoot ? 'group' : 'subgroup') + (g.children.length === 1 ? '' : 's') +
        (isRoot ? ' <span class="muted">· ' + ungrouped + ' ungrouped</span>' : ', ' + g.repos.length + ' repositor' + (g.repos.length === 1 ? 'y' : 'ies'));
      body = level(g, 0, isRoot);
      if (!items && !(isRoot && ungrouped)) body = emptyState('This group is empty', 'Add a match rule or create a subgroup.');
    }
    html += '<div class="box"><div class="box-head"><span>' + head + '</span><span class="muted">Sort: Last pushed</span></div><div class="rows">' + body + '</div></div>';
    return html;
  }

  function level(g, depth, isRoot) {
    var out = '';
    g.children.forEach(function (c) {
      var key = keyOf(c);
      var open = !!state.expanded[key];
      out += groupRow(c, depth, open);
      if (open) out += level(c, depth + 1, false);
    });
    var rs = g.repos.slice().sort(byAgo);
    if (isRoot) rs.forEach(function (r) { out += repoRow(r, depth); });
    else rs.forEach(function (r) { out += repoRow(r, depth); });
    return out;
  }

  function stat(label, v) { return '<div class="stat"><span>' + label + '</span><b>' + esc(v) + '</b></div>'; }
  function byAgo(a, b) { return a.ago - b.ago; }
  function emptyState(t, s) { return '<div class="empty"><b>' + t + '</b>' + s + '</div>'; }

  function toolbar(ph) {
    return '<div class="toolbar"><label class="search">' + svg('search') + '<input id="repo-search" type="search" placeholder="' + esc(ph) + '" value="' + esc(state.q) + '" aria-label="' + esc(ph) + '"></label>' +
      '<div class="view-seg" role="group" aria-label="View">' +
      '<button type="button" id="v-grouped" data-view="grouped" title="Grouped view" aria-pressed="' + (state.view === 'grouped') + '">' + svg('folder') + '</button>' +
      '<button type="button" id="v-flat" data-view="flat" title="GitHub list view" aria-pressed="' + (state.view === 'flat') + '">' + svg('list') + '</button></div></div>';
  }

  function groupRow(g, depth, open) {
    var key = keyOf(g);
    var n = allRepos(g).length, s = subCount(g);
    return '<div class="row" style="--depth:' + depth + '">' +
      '<button type="button" class="chev" data-toggle="' + esc(key) + '" aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse ' : 'Expand ') + esc(g.name) + '">' + svg('chev') + '</button>' +
      avatar(g, 'av') +
      '<div class="row-main"><div class="row-title"><a href="#" class="grp" data-go="' + esc(key) + '">' + esc(g.name) + '</a><span class="label">Group</span></div>' +
      (g.desc ? '<p class="desc">' + esc(g.desc) + '</p>' : '') +
      '<div class="meta"><span>' + svg('repo', 14) + n + ' repositor' + (n === 1 ? 'y' : 'ies') + '</span>' + (s ? '<span>' + svg('folder', 14) + s + ' subgroup' + (s === 1 ? '' : 's') + '</span>' : '') + '<span>Updated ' + ago(latest(g)) + '</span></div></div>' +
      '<div class="row-side"><span>Rules: ' + (g.rules.length ? g.rules.map(esc).join(', ') : '—') + '</span></div></div>';
  }

  function repoRow(r, depth, scope) {
    var pre = '';
    if (scope && r.group !== scope) {
      var p = []; var x = r.group; while (x && x !== scope) { p.unshift(x.name); x = x.parent; }
      pre = p.length ? '<span class="path-pre">' + esc(p.join(' / ')) + ' / </span>' : '';
    }
    return '<div class="row" style="--depth:' + depth + '">' +
      '<span class="chev-sp"></span><span class="av av-repo">' + svg('repo') + '</span>' +
      '<div class="row-main"><div class="row-title"><a href="#" data-noop>' + pre + esc(r.name) + '</a><span class="label">' + (r.pub ? 'Public' : 'Private') + '</span></div>' +
      (r.desc ? '<p class="desc">' + esc(r.desc) + '</p>' : '') +
      '<div class="meta">' + (r.lang ? '<span><i class="lang-dot" style="background:' + LANG[r.lang] + '"></i>' + r.lang + '</span>' : '') +
      '<span>' + svg('fork', 14) + '0</span><span>' + svg('star', 14) + '0</span><span>' + svg('issue', 14) + '0</span><span>' + svg('pr', 14) + '0</span><span>Updated ' + ago(r.ago) + '</span></div></div></div>';
  }

  function renderFlat() {
    var list = repos.slice().sort(byAgo);
    if (state.q) { var q = state.q.toLowerCase(); list = list.filter(function (r) { return r.name.toLowerCase().indexOf(q) > -1; }); }
    return '<div class="banner"><span class="grow">This is GitHub’s default list. Repository Group can show it grouped by <code>infra</code>, <code>ai</code> and the other groups in <code>.github/repo-groups.yml</code>.</span><button type="button" class="btn" data-view="grouped">' + svg('folder') + 'Show grouped</button></div>' +
      '<h1 style="margin:0;font-size:24px;font-weight:600">All</h1>' + toolbar('Search repositories') +
      '<div class="box"><div class="box-head"><span>' + list.length + ' repositories <span class="muted">(10 of 45 shown in this mockup)</span></span><span class="muted">Last pushed</span></div><div class="rows">' +
      list.map(function (r) { return repoRow(r, 0); }).join('') + '</div></div>';
  }

  function rulesPanel(g) {
    var own = g.repos.map(function (r) { return '<span class="chip ro">' + esc(r.name) + '</span>'; }).join('') || '<span class="muted">No repository matches these rules yet.</span>';
    return '<div class="box"><div class="box-head"><span>How repositories join <code>' + esc(keyOf(g)) + '</code></span><button type="button" class="btn" data-edit="' + esc(keyOf(g)) + '">' + svg('pencil') + 'Edit rules</button></div>' +
      '<div class="rules"><div class="chips">' + (g.rules.length ? g.rules.map(function (r) { return '<span class="chip ro">' + esc(r) + '</span>'; }).join('') : '<span class="muted">No rules. Repositories only appear here through subgroups.</span>') + '</div>' +
      '<p class="desc">Patterns use <code>*</code> as a wildcard and are checked against the repository name. An exact name always wins; when several patterns match, the deepest group wins. New repositories are placed automatically on the next visit.</p>' +
      '<div><b>Matched directly here</b><div class="chips" style="margin-top:8px">' + own + '</div></div></div></div>';
  }

  // ---------- new repository page (GitHub's form + the injected Group field) ----------
  function normName(v) { return v.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''); }
  function groupList() { var out = []; (function walk(g, depth) { g.children.forEach(function (c) { out.push({ g: c, depth: depth }); walk(c, depth + 1); }); })(root, 0); return out; }
  function pathLabel(g) { var p = []; var x = g; while (x && x !== root) { p.unshift(x.name); x = x.parent; } return p.join(' / '); }

  function renderNewRepo() {
    var n = state.nr, pub = n.vis === 'public';
    function cfg(title, hint, ctrl) { return '<div class="cfg-row"><div class="text"><b>' + title + '</b><span class="hint">' + hint + '</span></div>' + ctrl + '</div>'; }
    function dd(label) { return '<button type="button" class="btn" data-noop>' + label + '<span class="caret-d">' + svg('chev') + '</span></button>'; }
    return '<div class="nr">' +
      '<div class="nr-intro"><h1>Create a new repository</h1><p>Repositories contain a project\'s files and version history. Have a project elsewhere? <a href="#" data-noop>Import a repository</a>.</p><p><em>Required fields are marked with an asterisk (*).</em></p></div>' +

      '<section class="nr-sec" aria-labelledby="nr-h1"><span class="nr-num">1</span><h2 id="nr-h1">General</h2>' +
      '<div class="nr-row">' +
      '<div class="field"><label>Owner *</label><span class="owner-pill"><span class="org-mark" aria-hidden="true">K</span>' + ORG + svg('chev', 12) + '</span></div>' +
      '<span class="nr-slash" aria-hidden="true">/</span>' +
      '<div class="field grow"><label for="nr-name">Repository name *</label><input class="input" id="nr-name" value="' + esc(n.name) + '" autocomplete="off" spellcheck="false"><span id="nr-avail"></span></div></div>' +
      '<span class="hint" style="font-size:14px">Great repository names are short and memorable. How about <a href="#" data-suggest="musical-enigma" style="color:var(--success-fg);text-decoration:underline">musical-enigma</a>?</span>' +
      '<div class="field"><label for="nr-desc">Description</label><input class="input" id="nr-desc" maxlength="350" value="' + esc(n.desc) + '" autocomplete="off"><span class="counter-hint" id="nr-desc-count">' + n.desc.length + ' / 350 characters</span></div>' +
      groupField() +
      '</section>' +

      '<section class="nr-sec last" aria-labelledby="nr-h2"><span class="nr-num">2</span><h2 id="nr-h2">Configuration</h2>' +
      '<div class="cfg">' + cfg('Choose visibility *', 'Choose who can see and commit to this repository',
        '<button type="button" class="btn" data-vis-toggle="1" aria-label="Visibility: ' + (pub ? 'Public' : 'Private') + '. Click to switch.">' + svg(pub ? 'globe' : 'lock') + (pub ? 'Public' : 'Private') + '<span class="caret-d">' + svg('chev') + '</span></button>') + '</div>' +
      '<div class="cfg">' + cfg('Start with a template', 'Templates pre-configure your repository with files.', dd('No template')) + '</div>' +
      '<div class="cfg">' +
      cfg('Add README', 'READMEs can be used as longer descriptions. <a href="#" data-noop>About READMEs</a>', '<button type="button" class="switch" id="nr-readme" data-readme="1" aria-pressed="' + !!n.readme + '"><span>' + (n.readme ? 'On' : 'Off') + '</span><span class="track"><span class="knob"></span></span></button>') +
      cfg('Add .gitignore', '.gitignore tells git which files not to track. <a href="#" data-noop>About ignoring files</a>', dd('No .gitignore')) +
      cfg('Add license', 'Licenses explain how others can use your code. <a href="#" data-noop>About licenses</a>', dd('No license')) +
      '</div></section>' +

      '<div class="nr-foot"><button type="button" class="btn btn-primary" data-nr-create="1">Create repository</button></div>' +
      '</div>';
  }

  function groupField() {
    var n = state.nr;
    var opts = '<li role="option" id="opt-auto" data-pick="" aria-selected="' + (n.group === null) + '"><span class="tick">' + (n.group === null ? svg('check') : '') + '</span>' + svg('sparkle') + '<span>Automatic <span class="muted" style="font-weight:400">· by match rules</span></span></li><li class="sep" role="presentation"></li>';
    groupList().forEach(function (it, i) {
      var k = keyOf(it.g), sel = n.group === k;
      opts += '<li role="option" id="opt-' + i + '" data-pick="' + esc(k) + '" aria-selected="' + sel + '" style="padding-left:' + (8 + it.depth * 18) + 'px"><span class="tick">' + (sel ? svg('check') : '') + '</span>' + avatar(it.g, 'mini-av') + '<span>' + esc(it.g.name) + '</span><span class="count">' + allRepos(it.g).length + '</span></li>';
    });
    return '<div class="inject" id="nr-group-field"><div class="inject-head"><label id="nr-group-label" for="nr-group">Group</label><span class="ext-tag"><i></i>Repository Group</span></div>' +
      '<div class="picker-wrap"><button type="button" class="picker" id="nr-group" aria-haspopup="listbox" aria-expanded="false" aria-controls="nr-pop"><span class="lbl" id="nr-group-lbl"></span><span class="caret">' + svg('chev') + '</span></button>' +
      '<ul class="pop" id="nr-pop" role="listbox" aria-labelledby="nr-group-label" tabindex="-1" hidden>' + opts + '</ul></div>' +
      '<div class="nr-dest" id="nr-dest"></div></div>';
  }

  // Refreshes the parts of the form that depend on the name or the picked group, without re-rendering inputs.
  function updateNr() {
    var n = state.nr; if (!n) return;
    var name = normName(n.name);
    var auto = name ? pickIn(postOrder(root, []), name) : null;
    var picked = n.group !== null ? find(n.group.split('/')) : null;
    var dest = picked || auto;
    var lbl = document.getElementById('nr-group-lbl');
    if (lbl) lbl.innerHTML = picked ? '<span style="display:inline-flex;gap:8px;align-items:center">' + avatar(picked, 'mini-av') + esc(pathLabel(picked)) + '</span>'
      : '<span style="display:inline-flex;gap:8px;align-items:center">' + svg('sparkle') + 'Automatic' + (auto ? ' <span class="muted">→ ' + esc(pathLabel(auto)) + '</span>' : '') + '</span>';
    var av = document.getElementById('nr-avail');
    if (av) {
      var taken = name && repos.some(function (r) { return r.name.toLowerCase() === name.toLowerCase(); });
      av.className = 'avail' + (taken ? ' err' : '');
      av.innerHTML = !name ? '' : taken ? svg('alert', 12) + 'The repository ' + esc(name) + ' already exists on this account.'
        : svg('checkcircle', 12) + esc(name) + ' is available.' + (name !== n.name.trim() ? ' <span class="muted" style="font-weight:400">Your new repository will be created as ' + esc(name) + '.</span>' : '');
    }
    var box = document.getElementById('nr-dest'); if (!box) return;
    var chain = []; var x = dest; while (x && x !== root) { chain.unshift(x); x = x.parent; }
    var path = '<div class="dest-path">' + avatar(root, 'mini-av') + esc(ORG) + chain.map(function (c) { return ' <span aria-hidden="true">/</span> ' + avatar(c, 'mini-av') + esc(c.name); }).join('') +
      ' <span aria-hidden="true">/</span> <b>' + esc(name || 'new-repository') + '</b></div>';
    var why;
    if (!name) why = 'Type a name to see which group it lands in.';
    else if (picked && auto === picked) why = 'Already matches the rule <code>' + esc(ruleFor(picked, name)) + '</code> of this group. repo-groups.yml stays the same.';
    else if (picked) why = 'Adds <code>' + esc(name) + '</code> to the match list of <b>' + esc(pathLabel(picked)) + '</b> in repo-groups.yml' + (auto ? ' (otherwise it would land in ' + esc(pathLabel(auto)) + ')' : '') + '.';
    else if (auto) why = 'Lands here because it matches the rule <code>' + esc(ruleFor(auto, name)) + '</code>. Pick another group to override.';
    else why = 'No rule matches this name yet, so it will show under Ungrouped. Pick a group to file it now.';
    box.innerHTML = path + '<span class="hint">' + why + '</span>';
  }

  function openNewRepo(fromKey) {
    state.page = 'new'; state.drawer = null;
    state.nr = { name: '', desc: '', group: fromKey ? fromKey : null, vis: 'private', readme: false };
    render(); window.scrollTo(0, 0);
    var i = document.getElementById('nr-name'); if (i) i.focus();
  }

  function setPop(open, focusSel) {
    var pop = document.getElementById('nr-pop'), btn = document.getElementById('nr-group'); if (!pop) return;
    pop.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (open) {
      var items = popItems(), sel = items.filter(function (li) { return li.getAttribute('aria-selected') === 'true'; })[0] || items[0];
      setActive(sel); if (focusSel !== false) pop.focus();
    }
  }
  function popItems() { return Array.prototype.slice.call(document.querySelectorAll('#nr-pop [role="option"]')); }
  function setActive(li) {
    popItems().forEach(function (x) { x.classList.toggle('active', x === li); });
    var pop = document.getElementById('nr-pop');
    if (li && pop) { pop.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
  }
  function pick(key) {
    state.nr.group = key === '' ? null : key;
    var field = document.getElementById('nr-group-field');
    field.outerHTML = groupField();
    updateNr();
    document.getElementById('nr-group').focus();
  }

  function createRepo() {
    var n = state.nr, name = normName(n.name), av = document.getElementById('nr-avail');
    if (!name) { av.className = 'avail err'; av.innerHTML = svg('alert', 12) + 'Enter a repository name.'; document.getElementById('nr-name').focus(); return; }
    if (repos.some(function (r) { return r.name.toLowerCase() === name.toLowerCase(); })) { updateNr(); document.getElementById('nr-name').focus(); return; }
    var auto = pickIn(postOrder(root, []), name);
    var picked = n.group !== null ? find(n.group.split('/')) : null;
    var changed = picked && picked !== auto;
    if (changed) picked.rules.push(name);
    repos.unshift({ name: name, desc: n.desc.trim(), lang: null, ago: 0, pub: n.vis === 'public' });
    var dest = picked || auto;
    state.page = null; state.nr = null; state.view = 'grouped'; state.tab = 'items'; state.q = '';
    state.path = dest ? pathOf(dest) : [];
    if (dest) { var k = []; pathOf(dest).forEach(function (id) { k.push(id); state.expanded[k.join('/')] = true; }); }
    render(); window.scrollTo(0, 0);
    toast('Created ' + ORG + '/' + name + (dest ? ' in ' + pathLabel(dest) : ' (ungrouped)') + (changed ? ' · repo-groups.yml updated' : ''));
  }

  // ---------- drawer ----------
  function d0(d) { d.logoData = null; d.logoRemoved = false; d.urlOpen = false; d.crop = null; d.logoErr = ''; }
  function draftKey(d) { return (d.parentKey ? d.parentKey + '/' : '') + (d.name || 'new-group'); }
  function draftLogoPath(d) { return 'logos/' + draftKey(d).replace(/\//g, '-') + '.png'; }
  function draftLogo(d, g) { if (d.logoData) return draftLogoPath(d); if (d.logoRemoved) return null; return g ? g.logo || null : null; }
  function openDrawer(mode, key, focusLogo) {
    var g = find(key ? key.split('/') : []);
    state.drawer = mode === 'edit'
      ? { mode: 'edit', key: key, name: g.name, desc: g.desc || '', rules: g.rules.slice(), parentKey: keyOf(g.parent), logo: g.logo || null }
      : { mode: 'new', key: null, name: '', desc: '', rules: [], parentKey: key || '', logo: null };
    d0(state.drawer);
    renderDrawer();
    var n = document.getElementById(focusLogo ? 'd-logo-upload' : 'd-name'); if (n) n.focus();
  }

  function renderDrawer() {
    var d = state.drawer; var rootEl = document.getElementById('drawer-root');
    if (!d) { rootEl.innerHTML = ''; return; }
    var parent = find(d.parentKey ? d.parentKey.split('/') : []);
    var parentLabel = parent === root ? ORG : ORG + ' / ' + pathOf(parent).join(' / ');
    var hits = d.rules.length ? repos.filter(function (r) { return matches(d.rules, r.name); }) : [];
    var editing = d.mode === 'edit' ? find(d.key.split('/')) : null;
    rootEl.innerHTML = '<div class="overlay" data-close="1"><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title">' +
      '<div class="drawer-head"><h2 id="d-title">' + (d.mode === 'edit' ? 'Edit group' : 'New group') + '</h2><button type="button" class="chev" data-close="1" aria-label="Close">' + svg('x') + '</button></div>' +
      '<div class="drawer-body">' +
      logoField(d) +
      '<div class="field"><label for="d-name">Name</label><input class="input" id="d-name" value="' + esc(d.name) + '" placeholder="e.g. dagu" autocomplete="off"><span class="hint">Used in the path: ' + esc(parentLabel) + ' / <b>' + esc(d.name || 'name') + '</b></span><span class="error" id="d-err"></span></div>' +
      '<div class="field"><label for="d-desc">Description</label><input class="input" id="d-desc" value="' + esc(d.desc) + '" placeholder="Optional" autocomplete="off"></div>' +
      '<div class="field"><label for="d-rule">Match rules</label><span class="hint">Repository names to include. Use <code>*</code> as a wildcard, like <code>dags-*</code> or <code>*authentik*</code>.</span>' +
      '<div class="chips">' + d.rules.map(function (r, i) { return '<span class="chip">' + esc(r) + '<button type="button" data-rm="' + i + '" aria-label="Remove rule ' + esc(r) + '">' + svg('x', 12) + '</button></span>'; }).join('') + '</div>' +
      '<div class="add-rule"><input class="input mono" id="d-rule" placeholder="Add a pattern and press Enter" autocomplete="off"><button type="button" class="btn" data-addrule="1">Add</button></div></div>' +
      '<div class="field"><label>Matching repositories (' + hits.length + ')</label>' +
      (hits.length ? '<ul class="match-list">' + hits.map(function (r) {
        var from = r.group && r.group !== root && r.group !== editing ? '<span class="moved">now in ' + esc(keyOf(r.group)) + '</span>' : '';
        return '<li>' + svg('repo', 14) + esc(r.name) + from + '</li>';
      }).join('') + '</ul>' : '<span class="hint">No repositories match yet.</span>') + '</div>' +
      '<div class="field"><label>File</label><button type="button" class="linkish" data-yaml-open="1">' + svg('code') + 'Edit .github/repo-groups.yml</button><span class="hint">Opens the whole file, including this draft. Copy it to an AI, paste the answer back and save.</span></div>' +
      '</div>' +
      '<div class="drawer-foot"><span class="grow">Saved as a commit to <code>' + ORG + '/.github</code>, so everyone in the org sees the same groups.</span>' +
      '<button type="button" class="btn" data-close="1">Cancel</button><button type="button" class="btn btn-primary" data-save="1">' + svg('check') + (d.mode === 'edit' ? 'Save changes' : 'Create group') + '</button></div>' +
      '</div></div>';
    if (d.crop) setupCropper();
    bindDrop();
  }

  function logoField(d) {
    var src = d.logoData || (!d.logoRemoved && d.logo ? logoSrc({ logo: d.logo }) : null);
    var letter = (d.name || '?')[0].toUpperCase();
    var prev = src ? '<img class="big-av logo-img" src="' + esc(src) + '" alt="Current logo" data-letter="' + esc(letter) + '" data-cls="big-av ' + avClass(d.name || '?') + '">'
                   : '<span class="big-av ' + avClass(d.name || '?') + '">' + esc(letter) + '</span>';
    var html = '<div class="field"><label for="d-logo-upload">Logo</label>' +
      '<div class="logo-field" id="logo-drop">' + prev + '<div class="stack"><div class="y-tools">' +
      '<button type="button" class="btn" id="d-logo-upload" data-logo-upload="1">' + svg('image') + 'Upload image</button>' +
      '<button type="button" class="btn" data-logo-url-toggle="1" aria-expanded="' + d.urlOpen + '">' + svg('link') + 'Paste a link</button></div>' +
      '<span class="hint">PNG, JPG, SVG or WebP up to 5 MB. You can also drop a file here or paste an image.' + (src ? ' <button type="button" class="linkish" data-logo-remove="1">Use the letter instead</button>' : '') + '</span>' +
      '<input type="file" id="d-file" accept="image/*" hidden></div></div>';
    if (d.urlOpen) html += '<div class="add-rule"><input class="input" id="d-logo-url" type="url" placeholder="https://example.com/logo.png" autocomplete="off"><button type="button" class="btn" data-logo-load="1">Load</button></div>';
    if (d.logoErr) html += '<span class="error" role="alert">' + esc(d.logoErr) + '</span>';
    if (d.crop) html += '<div class="cropper"><canvas id="crop-canvas" tabindex="0" aria-label="Logo crop. Drag or use the arrow keys to move, plus and minus to zoom."></canvas>' +
      '<div class="zoom-row">' + svg('zoomout') + '<input type="range" id="crop-zoom" min="1" max="5" step="0.01" value="' + d.crop.zoom + '" aria-label="Zoom"><output id="crop-zoom-out">' + d.crop.zoom.toFixed(1) + '×</output>' + svg('plus') + '</div>' +
      '<div class="y-tools"><span class="grow hint">Drag to reposition. Scroll or use the slider to zoom. The square is what shows on the group.</span>' +
      '<button type="button" class="btn" data-crop-cancel="1">Cancel</button><button type="button" class="btn btn-primary" data-crop-apply="1">' + svg('check') + 'Use this crop</button></div></div>';
    return html + '</div>';
  }

  // ---------- logo crop ----------
  var CV = 280, CC = 240, CM = 20, OUT = 192;
  function loadLogo(src, fromLink) {
    var d = state.drawer; if (!d) return;
    var img = new Image();
    if (fromLink) img.crossOrigin = 'anonymous';
    img.onload = function () {
      var w = img.naturalWidth || 512, h = img.naturalHeight || 512;
      var minS = Math.max(CC / w, CC / h);
      d.crop = { img: img, w: w, h: h, minS: minS, s: minS, zoom: 1, tx: CM + (CC - w * minS) / 2, ty: CM + (CC - h * minS) / 2 };
      d.logoErr = ''; d.urlOpen = false;
      renderDrawer();
      var c = document.getElementById('crop-canvas'); if (c) c.focus();
    };
    img.onerror = function () {
      d.logoErr = fromLink
        ? 'That link did not load as an image. Use a direct link to the file (ending in .png, .jpg, .svg or .webp). This preview page blocks images from other sites, so here only uploads work; the extension loads links normally.'
        : 'That file could not be read as an image. Try a PNG, JPG, SVG or WebP.';
      renderDrawer();
    };
    img.src = src;
  }
  function loadFile(file) {
    var d = state.drawer; if (!d || !file) return;
    syncDrawerInputs();
    if (!/^image\//.test(file.type)) { d.logoErr = 'That file is not an image. Choose a PNG, JPG, SVG or WebP.'; renderDrawer(); return; }
    if (file.size > 5 * 1024 * 1024) { d.logoErr = 'That image is larger than 5 MB. Choose a smaller file.'; renderDrawer(); return; }
    var fr = new FileReader();
    fr.onload = function () { loadLogo(fr.result, false); };
    fr.onerror = function () { d.logoErr = 'The file could not be read. Try choosing it again.'; renderDrawer(); };
    fr.readAsDataURL(file);
  }
  function clampCrop(c) {
    c.tx = Math.min(CM, Math.max(CM + CC - c.w * c.s, c.tx));
    c.ty = Math.min(CM, Math.max(CM + CC - c.h * c.s, c.ty));
  }
  function setZoom(z) {
    var c = state.drawer && state.drawer.crop; if (!c) return;
    z = Math.min(5, Math.max(1, z));
    var ns = c.minS * z, cx = CV / 2;
    var px = (cx - c.tx) / c.s, py = (cx - c.ty) / c.s;
    c.tx = cx - px * ns; c.ty = cx - py * ns; c.s = ns; c.zoom = z;
    clampCrop(c); drawCrop();
    var r = document.getElementById('crop-zoom'), o = document.getElementById('crop-zoom-out');
    if (r) r.value = z; if (o) o.textContent = z.toFixed(1) + '×';
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function drawCrop() {
    var c = state.drawer && state.drawer.crop, cv = document.getElementById('crop-canvas'); if (!c || !cv) return;
    var dpr = window.devicePixelRatio || 1, cs = getComputedStyle(document.documentElement);
    if (cv.width !== CV * dpr) { cv.width = CV * dpr; cv.height = CV * dpr; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cs.getPropertyValue('--bg').trim() || '#ffffff';
    ctx.fillRect(0, 0, CV, CV);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c.img, c.tx, c.ty, c.w * c.s, c.h * c.s);
    var r = CC * 0.18;
    ctx.beginPath(); ctx.rect(0, 0, CV, CV); roundRect(ctx, CM, CM, CC, CC, r);
    ctx.fillStyle = cs.getPropertyValue('--crop-dim').trim(); ctx.fill('evenodd');
    ctx.beginPath(); roundRect(ctx, CM + 0.75, CM + 0.75, CC - 1.5, CC - 1.5, r);
    ctx.strokeStyle = cs.getPropertyValue('--crop-line').trim(); ctx.lineWidth = 1.5; ctx.stroke();
  }
  function setupCropper() {
    var cv = document.getElementById('crop-canvas'), c = state.drawer.crop; if (!cv) return;
    drawCrop();
    var drag = null;
    function scale() { return CV / cv.getBoundingClientRect().width; }
    cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, tx: c.tx, ty: c.ty, k: scale() }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', function (e) {
      if (!drag) return;
      c.tx = drag.tx + (e.clientX - drag.x) * drag.k; c.ty = drag.ty + (e.clientY - drag.y) * drag.k;
      clampCrop(c); drawCrop();
    });
    cv.addEventListener('pointerup', function () { drag = null; });
    cv.addEventListener('pointercancel', function () { drag = null; });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); setZoom(c.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    cv.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 24 : 8, k = e.key;
      if (k === 'ArrowLeft') c.tx += step; else if (k === 'ArrowRight') c.tx -= step;
      else if (k === 'ArrowUp') c.ty += step; else if (k === 'ArrowDown') c.ty -= step;
      else if (k === '+' || k === '=') { e.preventDefault(); setZoom(c.zoom + 0.1); return; }
      else if (k === '-' || k === '_') { e.preventDefault(); setZoom(c.zoom - 0.1); return; }
      else return;
      e.preventDefault(); clampCrop(c); drawCrop();
    });
    document.getElementById('crop-zoom').addEventListener('input', function (e) { setZoom(parseFloat(e.target.value)); });
  }
  function applyCrop() {
    var d = state.drawer, c = d && d.crop; if (!c) return;
    syncDrawerInputs();
    var out = document.createElement('canvas'); out.width = OUT; out.height = OUT;
    var ctx = out.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    var side = CC / c.s;
    ctx.drawImage(c.img, (CM - c.tx) / c.s, (CM - c.ty) / c.s, side, side, 0, 0, OUT, OUT);
    try { d.logoData = out.toDataURL('image/png'); d.logoRemoved = false; d.crop = null; d.logoErr = ''; }
    catch (_) { d.logoErr = 'The site hosting this image does not allow it to be edited in the browser. Download the image and upload the file instead.'; }
    renderDrawer();
    var b = document.getElementById('d-logo-upload'); if (b) b.focus();
  }
  function bindDrop() {
    var z = document.getElementById('logo-drop'); if (!z) return;
    z.addEventListener('dragover', function (e) { e.preventDefault(); z.classList.add('drop-on'); });
    z.addEventListener('dragleave', function () { z.classList.remove('drop-on'); });
    z.addEventListener('drop', function (e) { e.preventDefault(); z.classList.remove('drop-on'); var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
  }

  function q(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function yamlPreview() {
    var d = state.drawer; var lines = ['# ' + ORG + '/.github/repo-groups.yml', 'version: 1', 'groups:'];
    function emit(g, ind) {
      var isEdit = d && d.mode === 'edit' && keyOf(g) === d.key;
      var name = isEdit ? (d.name || g.name) : g.name;
      var desc = isEdit ? d.desc : g.desc;
      var rules = isEdit ? d.rules : g.rules;
      var logo = isEdit ? draftLogo(d, g) : g.logo;
      lines.push(ind + '- name: ' + name);
      if (desc) lines.push(ind + '  description: ' + q(desc));
      if (logo) lines.push(ind + '  logo: ' + q(logo));
      if (rules.length) lines.push(ind + '  match: [' + rules.map(q).join(', ') + ']');
      var kids = g.children.slice();
      var newHere = d && d.mode === 'new' && d.parentKey === keyOf(g) && g !== root;
      if (kids.length || newHere) {
        lines.push(ind + '  groups:');
        kids.forEach(function (c) { emit(c, ind + '    '); });
        if (newHere) emitNew(ind + '    ');
      }
    }
    function emitNew(ind) {
      lines.push(ind + '- name: ' + (d.name || 'new-group'));
      if (d.desc) lines.push(ind + '  description: ' + q(d.desc));
      if (d.logoData) lines.push(ind + '  logo: ' + q(draftLogoPath(d)));
      if (d.rules.length) lines.push(ind + '  match: [' + d.rules.map(q).join(', ') + ']');
    }
    root.children.forEach(function (c) { emit(c, '  '); });
    if (d && d.mode === 'new' && d.parentKey === '') emitNew('  ');
    return lines.join('\n') + '\n';
  }

  // ---------- YAML editor ----------
  var AI_PROMPT = [
    'You are a software architect organizing the GitHub repositories of the "' + ORG + '" organization into groups and subgroups, the way GitLab organizes projects.',
    '',
    'Task:',
    '1. Read every repository in the "repositories" list (name, description, language).',
    '2. Classify each one by what it does: product or business domain, platform/infrastructure service, deployment or config of a third-party tool, data and automation, libraries and tooling, docs, experiments or archived work.',
    '3. Build a clear hierarchy from that classification. Reuse and improve the current groups when they make sense; merge, split, rename or remove them when that makes the structure clearer.',
    '4. Put every repository in exactly one group using "match" rules. A fork or upstream copy (for example "litellm") belongs in the same group as the deployment that uses it (for example "konnen-litellm").',
    '',
    'Output rules:',
    '- Answer with ONLY the complete YAML inside one ```yaml block. No explanations before or after.',
    '- Keep the format: version, then groups -> name, description, logo, match, groups (nested subgroups).',
    '- name: short and lowercase; letters, numbers, "-", "_" or "."; unique among siblings.',
    '- Use at most 3 levels. Prefer 3 to 9 groups per level. Avoid a group with a single repository unless it clearly stands alone.',
    '- match: exact repository names or patterns with * as wildcard. Prefer patterns that will also catch future repositories of the same kind (for example "dags-*"), without catching repositories that belong elsewhere. An exact name always wins over a pattern; when several patterns match, the deepest group wins.',
    '- description: one short sentence, up to about 80 characters, saying what the group holds.',
    '- Keep every "logo" value exactly as it is, on the same group.',
    '- Do not include the "repositories" list in your answer.'
  ].join('\n');

  function aiText(yamlText) {
    var ctx = ['', 'repositories:  # read-only context, ignored when pasted back'];
    repos.forEach(function (r) {
      ctx.push('  - name: ' + r.name);
      if (r.desc) ctx.push('    description: ' + q(r.desc));
      if (r.lang) ctx.push('    language: ' + r.lang);
    });
    return AI_PROMPT + '\n\nCurrent file and repositories:\n\n```yaml\n' + yamlText.replace(/\s+$/, '') + '\n' + ctx.join('\n') + '\n```\n';
  }

  function stripFences(t) {
    var m = t.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/i);
    return m ? { text: m[1], stripped: true } : { text: t, stripped: false };
  }

  // Turns parsed YAML into a group tree, or returns the first problem found.
  function treeFromYaml(text) {
    if (!window.jsyaml) return { error: 'The YAML parser did not load. Check your connection and reopen the editor.' };
    var f = stripFences(text), obj;
    try { obj = jsyaml.load(f.text); }
    catch (e) { return { error: (e.reason || 'Invalid YAML') + (e.mark ? ' (line ' + (e.mark.line + 1) + ')' : ''), line: e.mark ? e.mark.line + 1 : null }; }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.groups)) return { error: 'The file needs a top-level "groups:" list.' };
    var t = { id: '', name: ORG, desc: root.desc, rules: [], children: [] };
    var err = null;
    function build(list, parent, where) {
      var seen = {};
      list.forEach(function (it, i) {
        if (err) return;
        var at = where + ' → item ' + (i + 1);
        if (!it || typeof it !== 'object') { err = at + ' must be a group with a name.'; return; }
        var name = typeof it.name === 'string' ? it.name.trim() : '';
        if (!/^[a-z0-9._-]+$/.test(name)) { err = at + ': name "' + (it.name == null ? '' : it.name) + '" must use lowercase letters, numbers, - _ or .'; return; }
        if (seen[name]) { err = 'Two groups are named "' + name + '" in ' + where + '.'; return; }
        seen[name] = 1;
        var match = it.match == null ? [] : it.match;
        if (typeof match === 'string') match = [match];
        if (!Array.isArray(match) || match.some(function (m) { return typeof m !== 'string'; })) { err = '"' + name + '": match must be a list of names or patterns.'; return; }
        var g = { id: name, name: name, desc: typeof it.description === 'string' ? it.description : '', logo: typeof it.logo === 'string' && it.logo.trim() ? it.logo.trim() : null, rules: match.map(function (m) { return m.trim(); }).filter(Boolean), children: [] };
        parent.children.push(g);
        if (it.groups != null) {
          if (!Array.isArray(it.groups)) { err = '"' + name + '": groups must be a list.'; return; }
          build(it.groups, g, name);
        }
      });
    }
    build(obj.groups, t, 'groups');
    if (err) return { error: err };
    link(t);
    return { tree: t, stripped: f.stripped };
  }

  // Where each repo lands for a given tree: name -> group path ('' = ungrouped).
  function placement(t) {
    var order = postOrder(t, []); var out = {};
    repos.forEach(function (r) {
      var hit = pickIn(order, r.name);
      out[r.name] = hit ? keyOf(hit) : '';
    });
    return out;
  }
  function flatGroups(t) { var m = {}; (function walk(g) { g.children.forEach(function (c) { m[keyOf(c)] = c; walk(c); }); })(t); return m; }

  function diffTrees(a, b) {
    var ga = flatGroups(a), gb = flatGroups(b), pa = placement(a), pb = placement(b), out = [];
    Object.keys(gb).forEach(function (k) { if (!ga[k]) out.push({ k: '+', cls: 'add', text: 'New group', to: k }); });
    Object.keys(ga).forEach(function (k) { if (!gb[k]) out.push({ k: '−', cls: 'del', text: 'Removed group', to: k }); });
    Object.keys(gb).forEach(function (k) {
      if (!ga[k]) return;
      if ((ga[k].desc || '') !== (gb[k].desc || '')) out.push({ k: '~', cls: 'chg', text: 'Description of ' + k, to: '“' + (gb[k].desc || '(empty)') + '”' });
      if ((ga[k].logo || '') !== (gb[k].logo || '')) out.push({ k: '~', cls: 'chg', text: 'Logo of ' + k, to: gb[k].logo || 'letter' });
      if (ga[k].rules.join('|') !== gb[k].rules.join('|')) out.push({ k: '~', cls: 'chg', text: 'Rules of ' + k, to: gb[k].rules.join(', ') || '(none)' });
    });
    repos.forEach(function (r) {
      if (pa[r.name] !== pb[r.name]) out.push({ k: '→', cls: 'mov', text: r.name, to: (pa[r.name] || 'ungrouped') + ' → ' + (pb[r.name] || 'ungrouped') });
    });
    var ungrouped = repos.filter(function (r) { return !pb[r.name]; }).length;
    return { items: out, groups: Object.keys(gb).length, ungrouped: ungrouped };
  }

  function openYaml() {
    syncDrawerInputs();
    if (state.drawer && state.drawer.logoData) logoFiles[draftLogoPath(state.drawer)] = state.drawer.logoData;
    var text = yamlPreview();
    state.drawer = null;
    state.yaml = { original: text, text: text };
    renderYaml();
    var ta = document.getElementById('y-text'); if (ta) ta.focus();
  }

  function renderYaml() {
    var y = state.yaml; var rootEl = document.getElementById('drawer-root');
    if (!y) { rootEl.innerHTML = ''; return; }
    rootEl.innerHTML = '<div class="overlay" data-close="1"><div class="drawer wide" role="dialog" aria-modal="true" aria-labelledby="y-title">' +
      '<div class="drawer-head"><h2 id="y-title">' + svg('code') + ' .github/repo-groups.yml</h2><button type="button" class="chev" data-close="1" aria-label="Close">' + svg('x') + '</button></div>' +
      '<div class="drawer-body">' +
      '<ol class="y-steps"><li><b>Copy prompt for AI + YML</b> and paste it into ChatGPT, Claude or any assistant.</li><li>Paste the answer back here, over the whole file. Code fences are removed for you.</li><li>Check the changes below, then <b>Apply and commit</b>.</li></ol>' +
      '<div class="y-tools copy-row"><button type="button" class="btn btn-accent" data-copy="all">' + svg('sparkle') + 'Copy prompt for AI + YML</button>' +
      '<span class="copy-split"><button type="button" class="btn" data-copy="prompt">' + svg('copy') + 'Copy prompt for AI</button>' +
      '<button type="button" class="btn" data-copy="yaml">' + svg('copy') + 'Copy YML</button></span><span class="grow"></span>' +
      '<button type="button" class="linkish" data-yaml-reset="1">Reset to saved file</button></div>' +
      '<div class="ai-fallback" id="y-fallback" hidden><span class="hint">Your browser blocked copying. The text is selected below; press Ctrl+C or ⌘C.</span><textarea id="y-ai" readonly aria-label="Text to copy"></textarea></div>' +
      '<div class="y-editor"><div class="y-gutter" id="y-gutter" aria-hidden="true"></div><div class="y-code"><pre class="y-hl" id="y-hl" aria-hidden="true"></pre><textarea id="y-text" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="repo-groups.yml contents"></textarea></div></div>' +
      '<div id="y-status"></div>' +
      '</div>' +
      '<div class="drawer-foot"><span class="grow">Commits to <code>' + ORG + '/.github</code> on the default branch.</span>' +
      '<button type="button" class="btn" data-close="1">Cancel</button><button type="button" class="btn btn-primary" id="y-apply" data-yaml-apply="1">' + svg('check') + 'Apply and commit</button></div>' +
      '</div></div>';
    var ta = document.getElementById('y-text');
    ta.value = y.text;
    ta.addEventListener('scroll', syncYamlScroll);
    paintYaml();
    updateYaml();
  }

  // Basic YAML coloring: keys, list dashes, strings, constants, brackets and comments.
  function tok(cls, t) { return '<span class="t-' + cls + '">' + esc(t) + '</span>'; }
  function hlValue(v) {
    var re = /("(?:[^"\\]|\\.)*"?|'[^']*'?)|([\[\]{},])|\b(true|false|null|yes|no)\b|(^|\s)(-?\d+(?:\.\d+)?)(?=\s|$|,|\])/g, out = '', last = 0, m;
    while ((m = re.exec(v))) {
      out += esc(v.slice(last, m.index));
      if (m[1]) out += tok('str', m[1]);
      else if (m[2]) out += tok('punc', m[2]);
      else if (m[3]) out += tok('const', m[3]);
      else out += esc(m[4]) + tok('const', m[5]);
      last = re.lastIndex;
    }
    return out + esc(v.slice(last));
  }
  function hlLine(line) {
    var code = line, com = '', inS = false, inD = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"' && !inS && line[i - 1] !== '\\') inD = !inD;
      else if (c === "'" && !inD) inS = !inS;
      else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) { code = line.slice(0, i); com = line.slice(i); break; }
    }
    var out, m = code.match(/^(\s*)(-\s+)?([A-Za-z0-9_.-]+)(\s*:)(?=\s|$)(.*)$/);
    if (m) out = esc(m[1]) + (m[2] ? tok('dash', m[2]) : '') + tok('key', m[3]) + tok('punc', m[4]) + hlValue(m[5]);
    else if ((m = code.match(/^(\s*)(-\s+|-$)(.*)$/))) out = esc(m[1]) + tok('dash', m[2]) + hlValue(m[3]);
    else if (/^\s*```/.test(code)) out = tok('com', code);
    else out = hlValue(code);
    return out + (com ? tok('com', com) : '');
  }
  function paintYaml() {
    var ta = document.getElementById('y-text'), hl = document.getElementById('y-hl'); if (!ta || !hl) return;
    hl.innerHTML = ta.value.split('\n').map(hlLine).join('\n') + '\n ';
    paintGutter(); syncYamlScroll();
  }
  function paintGutter() {
    var ta = document.getElementById('y-text'), gut = document.getElementById('y-gutter'); if (!ta || !gut) return;
    var bad = state.yaml && state.yaml.result ? state.yaml.result.line : null;
    var n = ta.value.split('\n').length, g = '';
    for (var i = 1; i <= n; i++) g += (bad === i ? '<span class="bad">' + i + '</span>' : i) + '\n';
    gut.innerHTML = g + ' ';
  }
  function syncYamlScroll() {
    var ta = document.getElementById('y-text'); if (!ta) return;
    var hl = document.getElementById('y-hl'), gut = document.getElementById('y-gutter');
    if (hl) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
    if (gut) gut.scrollTop = ta.scrollTop;
  }

  function updateYaml() {
    var y = state.yaml; if (!y) return;
    var ta = document.getElementById('y-text'); y.text = ta.value;
    var res = treeFromYaml(y.text);
    y.result = res;
    paintGutter();
    var st = document.getElementById('y-status'), apply = document.getElementById('y-apply');
    if (res.error) {
      st.innerHTML = '<div class="y-status err" role="status">' + svg('alert') + '<span>' + esc(res.error) + '</span></div>';
      apply.disabled = true; apply.style.opacity = 0.5; return;
    }
    var d = diffTrees(root, res.tree);
    var summary = d.groups + ' groups · ' + (repos.length - d.ungrouped) + ' of ' + repos.length + ' repositories grouped' + (d.ungrouped ? ' · ' + d.ungrouped + ' ungrouped' : '') + (res.stripped ? ' · code fences removed' : '');
    if (!d.items.length) {
      st.innerHTML = '<div class="y-status same" role="status">' + svg('check') + '<span>Valid. No changes yet. ' + esc(summary) + '</span></div>';
      apply.disabled = true; apply.style.opacity = 0.5; return;
    }
    st.innerHTML = '<div class="field"><div class="y-status ok" role="status">' + svg('check') + '<span>Valid. ' + d.items.length + ' change' + (d.items.length === 1 ? '' : 's') + ' · ' + esc(summary) + '</span></div>' +
      '<ul class="y-diff">' + d.items.map(function (it) {
        return '<li><span class="k ' + it.cls + '">' + it.k + '</span><span>' + esc(it.text) + '</span><span class="to">' + esc(it.to) + '</span></li>';
      }).join('') + '</ul></div>';
    apply.disabled = false; apply.style.opacity = '';
  }

  function applyYaml() {
    var y = state.yaml; if (!y || !y.result || !y.result.tree) return;
    var t = y.result.tree;
    root.children = t.children; link(root);
    var valid = flatGroups(root), exp = {};
    Object.keys(state.expanded).forEach(function (k) { if (valid[k] && state.expanded[k]) exp[k] = true; });
    state.expanded = exp;
    if (!find(state.path)) state.path = [];
    state.yaml = null; renderYaml(); render();
    toast('Committed to ' + ORG + '/.github/repo-groups.yml');
  }

  function copyText(text, label, onFail) {
    try {
      navigator.clipboard.writeText(text).then(function () { var b = document.getElementById('y-fallback'); if (b) b.hidden = true; toast(label); }, onFail);
    } catch (_) { onFail(); }
  }

  function syncDrawerInputs() {
    var d = state.drawer; if (!d) return;
    var n = document.getElementById('d-name'), ds = document.getElementById('d-desc');
    if (n) d.name = n.value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    if (ds) d.desc = ds.value;
  }

  function addRule() {
    syncDrawerInputs();
    var inp = document.getElementById('d-rule'); var v = (inp.value || '').trim();
    if (v && state.drawer.rules.indexOf(v) < 0) state.drawer.rules.push(v);
    renderDrawer();
    document.getElementById('d-rule').focus();
  }

  function saveDrawer() {
    syncDrawerInputs();
    var d = state.drawer;
    var parent = find(d.parentKey ? d.parentKey.split('/') : []);
    var err = document.getElementById('d-err');
    if (!d.name) { err.textContent = 'Give the group a name.'; document.getElementById('d-name').focus(); return; }
    var clash = parent.children.some(function (c) { return c.id === d.name && (d.mode === 'new' || keyOf(c) !== d.key); });
    if (clash) { err.textContent = 'A group named “' + d.name + '” already exists here.'; return; }
    var target;
    if (d.mode === 'edit') {
      target = find(d.key.split('/'));
      var wasOpen = state.expanded[d.key];
      target.id = d.name; target.name = d.name; target.desc = d.desc; target.rules = d.rules.slice();
      target.logo = draftLogo(d, target);
      if (wasOpen) state.expanded[keyOf(target)] = true;
      if (state.path.join('/') === d.key) state.path = pathOf(target);
    } else {
      target = { id: d.name, name: d.name, desc: d.desc, rules: d.rules.slice(), logo: d.logoData ? draftLogoPath(d) : null, children: [] };
      parent.children.push(target); link(root);
      if (parent !== root) state.expanded[keyOf(parent)] = true;
    }
    if (d.logoData) logoFiles[draftLogoPath(d)] = d.logoData;
    state.drawer = null; renderDrawer(); render();
    toast(d.logoData ? 'Committed repo-groups.yml and ' + draftLogoPath(d) : 'Committed to ' + ORG + '/.github/repo-groups.yml');
  }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast-root');
    el.innerHTML = '<div class="toast" role="status">' + svg('check') + esc(msg) + '</div>';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.innerHTML = ''; }, 2800);
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go],[data-toggle],[data-tab],[data-view],[data-flat],[data-edit],[data-new],[data-close],[data-save],[data-addrule],[data-rm],[data-theme-set],[data-noop],[data-yaml-open],[data-copy],[data-yaml-reset],[data-yaml-apply],[data-logo-upload],[data-logo-url-toggle],[data-logo-load],[data-logo-remove],[data-crop-cancel],[data-crop-apply],[data-newrepo],[data-nr-create],[data-nr-cancel],[data-pick],#nr-group,[data-vis-toggle],[data-readme],[data-suggest]');
    var pw = document.getElementById('nr-pop');
    if (pw && !pw.hidden && !e.target.closest('.picker-wrap')) setPop(false, false);
    if (!t) return;
    if (t.hasAttribute('data-close')) { if (t.classList.contains('overlay') ? e.target === t : true) closeOverlays(); return; }
    e.preventDefault();
    if (t.hasAttribute('data-noop')) return;
    if (t.hasAttribute('data-yaml-open')) { openYaml(); return; }
    if (t.hasAttribute('data-newrepo')) { openNewRepo(t.getAttribute('data-newrepo')); return; }
    if (t.hasAttribute('data-nr-cancel')) { state.page = null; state.nr = null; render(); return; }
    if (t.hasAttribute('data-nr-create')) { createRepo(); return; }
    if (t.hasAttribute('data-vis-toggle')) { state.nr.vis = state.nr.vis === 'public' ? 'private' : 'public'; render(); document.querySelector('[data-vis-toggle]').focus(); return; }
    if (t.hasAttribute('data-readme')) { state.nr.readme = !state.nr.readme; t.setAttribute('aria-pressed', String(state.nr.readme)); t.firstChild.textContent = state.nr.readme ? 'On' : 'Off'; return; }
    if (t.hasAttribute('data-suggest')) { state.nr.name = t.getAttribute('data-suggest'); document.getElementById('nr-name').value = state.nr.name; updateNr(); return; }
    if (t.id === 'nr-group') { setPop(document.getElementById('nr-pop').hidden); return; }
    if (t.hasAttribute('data-pick')) { pick(t.getAttribute('data-pick')); return; }
    if (t.hasAttribute('data-logo-upload')) { document.getElementById('d-file').click(); return; }
    if (t.hasAttribute('data-logo-url-toggle')) { syncDrawerInputs(); state.drawer.urlOpen = !state.drawer.urlOpen; state.drawer.logoErr = ''; renderDrawer(); var u = document.getElementById('d-logo-url'); if (u) u.focus(); return; }
    if (t.hasAttribute('data-logo-load')) { loadLink(); return; }
    if (t.hasAttribute('data-logo-remove')) { syncDrawerInputs(); state.drawer.logoData = null; state.drawer.logoRemoved = true; renderDrawer(); return; }
    if (t.hasAttribute('data-crop-cancel')) { syncDrawerInputs(); state.drawer.crop = null; renderDrawer(); return; }
    if (t.hasAttribute('data-crop-apply')) { applyCrop(); return; }
    if (t.hasAttribute('data-yaml-apply')) { applyYaml(); return; }
    if (t.hasAttribute('data-yaml-reset')) { document.getElementById('y-text').value = state.yaml.original; paintYaml(); updateYaml(); return; }
    if (t.hasAttribute('data-copy')) {
      var kind = t.getAttribute('data-copy'), yml = document.getElementById('y-text').value;
      var text = kind === 'all' ? aiText(yml) : kind === 'prompt' ? AI_PROMPT : yml;
      var label = kind === 'all' ? 'Prompt and YML copied' : kind === 'prompt' ? 'Prompt copied' : 'YML copied';
      copyText(text, label, function () {
        var box = document.getElementById('y-fallback'), ai = document.getElementById('y-ai');
        box.hidden = false; ai.value = text; ai.focus(); ai.select();
      });
      return;
    }
    if (t.hasAttribute('data-theme-set')) {
      var v = t.getAttribute('data-theme-set');
      try { if (v === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); } catch (_) {}
      document.querySelectorAll('[data-theme-set]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); });
      return;
    }
    if (t.hasAttribute('data-go') || t.hasAttribute('data-view') || t.hasAttribute('data-flat') || t.hasAttribute('data-tab')) { state.page = null; state.nr = null; }
    if (t.hasAttribute('data-go')) { var k = t.getAttribute('data-go'); state.path = k ? k.split('/') : []; state.view = 'grouped'; state.tab = 'items'; state.q = ''; if (k) state.expanded[k] = true; render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute('data-toggle')) { var key = t.getAttribute('data-toggle'); state.expanded[key] = !state.expanded[key]; render(); return; }
    if (t.hasAttribute('data-tab')) { state.tab = t.getAttribute('data-tab'); state.q = ''; render(); return; }
    if (t.hasAttribute('data-view')) { state.view = t.getAttribute('data-view'); state.q = ''; render(); return; }
    if (t.hasAttribute('data-flat')) { state.view = 'flat'; state.q = ''; render(); return; }
    if (t.hasAttribute('data-edit')) { openDrawer('edit', t.getAttribute('data-edit'), t.hasAttribute('data-logo-focus')); return; }
    if (t.hasAttribute('data-new')) { openDrawer('new', t.getAttribute('data-new')); return; }
    if (t.hasAttribute('data-addrule')) { addRule(); return; }
    if (t.hasAttribute('data-rm')) { syncDrawerInputs(); state.drawer.rules.splice(+t.getAttribute('data-rm'), 1); renderDrawer(); return; }
    if (t.hasAttribute('data-save')) { saveDrawer(); return; }
  });
  function loadLink() {
    var u = document.getElementById('d-logo-url'); var v = u ? u.value.trim() : '';
    syncDrawerInputs();
    if (!/^https?:\/\/\S+$/i.test(v)) { state.drawer.logoErr = 'Paste a full link that starts with https://'; renderDrawer(); var n = document.getElementById('d-logo-url'); if (n) { n.value = v; n.focus(); } return; }
    loadLogo(v, true);
  }
  document.addEventListener('change', function (e) {
    if (e.target.id === 'd-file' && e.target.files[0]) loadFile(e.target.files[0]);
  });
  document.addEventListener('paste', function (e) {
    if (!state.drawer || !e.clipboardData) return;
    var f = Array.prototype.filter.call(e.clipboardData.files || [], function (x) { return /^image\//.test(x.type); })[0];
    if (f) { e.preventDefault(); loadFile(f); }
  });
  // A logo link that stops loading falls back to the letter avatar.
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.getAttribute('data-letter')) {
      var s = document.createElement('span'); s.className = t.getAttribute('data-cls'); s.textContent = t.getAttribute('data-letter'); t.replaceWith(s);
    }
  }, true);
  function closeOverlays() { state.drawer = null; state.yaml = null; document.getElementById('drawer-root').innerHTML = ''; }
  var yamlTimer;
  document.addEventListener('input', function (e) {
    if (e.target.id === 'nr-name' && state.nr) { state.nr.name = e.target.value; updateNr(); return; }
    if (e.target.id === 'nr-desc' && state.nr) { state.nr.desc = e.target.value; document.getElementById('nr-desc-count').textContent = e.target.value.length + ' / 350 characters'; return; }
    if (e.target.id === 'y-text') { paintYaml(); clearTimeout(yamlTimer); yamlTimer = setTimeout(updateYaml, 150); return; }
    if (e.target.id === 'repo-search') { state.q = e.target.value; state.focusSearch = true; render(); }
    if (e.target.id === 'd-name') {
      syncDrawerInputs();
      var hint = e.target.parentNode.querySelector('.hint b'); if (hint) hint.textContent = state.drawer.name || 'name';
    }
  });
  document.addEventListener('keydown', function (e) {
    var pop = document.getElementById('nr-pop');
    if (pop && e.target.id === 'nr-group' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setPop(true); return; }
    if (pop && !pop.hidden && (e.target === pop || pop.contains(e.target))) {
      var items = popItems(), cur = items.indexOf(pop.querySelector('.active'));
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(items[Math.min(items.length - 1, cur + 1)]); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(items[Math.max(0, cur - 1)]); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(items[0]); }
      else if (e.key === 'End') { e.preventDefault(); setActive(items[items.length - 1]); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (cur > -1) pick(items[cur].getAttribute('data-pick')); }
      else if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); setPop(false, false); document.getElementById('nr-group').focus(); }
      return;
    }
    if (e.key === 'Enter' && e.target.id === 'nr-name') { e.preventDefault(); createRepo(); return; }
    if (e.key === 'Enter' && e.target.id === 'd-rule') { e.preventDefault(); addRule(); }
    if (e.key === 'Enter' && e.target.id === 'd-logo-url') { e.preventDefault(); loadLink(); }
    if (e.key === 'Tab' && e.target.id === 'y-text' && !e.shiftKey) {
      e.preventDefault();
      var ta = e.target, s = ta.selectionStart;
      ta.setRangeText('  ', s, ta.selectionEnd, 'end');
      paintYaml(); clearTimeout(yamlTimer); yamlTimer = setTimeout(updateYaml, 150);
    }
    if (e.key === 'Escape' && (state.drawer || state.yaml)) closeOverlays();
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { var s = document.getElementById('repo-search'); if (s) { e.preventDefault(); s.focus(); } }
  });

  link(root);
  render();
})();
