// npm run lint — bug-catching rules only (eslint:recommended), no style rules. Dev-only; not shipped.
const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const globals = require('globals');
const espree = require('espree');

// public/js/*.js are classic scripts that share one global scope (index.html loads them in order), so each may use
// the top-level names the others declare. Read those names with ESLint's own parser: no-undef still catches a typo.
const JS_DIR = path.join(__dirname, 'public', 'js');
function topLevelIds(program) {                       // the identifiers a script declares at its top level
  const ids = [];
  const add = (p) => {
    if (!p) return;
    if (p.type === 'Identifier') ids.push(p);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => add(q.type === 'RestElement' ? q.argument : q.value));
    else if (p.type === 'ArrayPattern') p.elements.forEach(add);
    else if (p.type === 'AssignmentPattern') add(p.left);
    else if (p.type === 'RestElement') add(p.argument);
  };
  for (const st of program.body) {
    if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') add(st.id);
    else if (st.type === 'VariableDeclaration') st.declarations.forEach((d) => add(d.id));
  }
  return ids;
}
const appScripts = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).map((f) => {
  const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
  return { file: 'public/js/' + f, src, names: topLevelIds(espree.parse(src, { ecmaVersion: 'latest' })).map((id) => id.name) };
});
// no-unused-vars can't see the other scripts, so count each top-level name across all of them: only its declaration = unused.
const uses = new Map();
for (const { src } of appScripts) for (const t of espree.tokenize(src, { ecmaVersion: 'latest' })) if (t.type === 'Identifier') uses.set(t.value, (uses.get(t.value) || 0) + 1);
const appRules = { rules: { 'unused-top-level': { meta: { type: 'problem' }, create: (context) => ({
  Program: (node) => topLevelIds(node).forEach((id) => {
    if (uses.get(id.name) === 1) context.report({ node: id, message: `'${id.name}' is declared but not used in any public/js script.` });
  }),
}) } } };

module.exports = [
  { ignores: ['docs/app/**', 'tools/commercial/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],   // `catch {}` is the house idiom for best-effort calls
      'no-control-regex': 'off',                          // terminal output is matched on ESC/BEL/C0 bytes on purpose
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],   // `_req`, and Express's 4-arg error handler (`_next`)
    },
  },
  {
    // Node: server, installer, CLI scripts, tests and capture tools (CommonJS)
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // Playwright code runs page.evaluate() callbacks in the browser
    files: ['tests/**/*.js', 'tools/capture/**/*.js', 'tools/soak/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The frontend: classic scripts, xterm.js and its addons loaded before them as globals
    files: ['public/js/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Terminal: 'readonly', FitAddon: 'readonly', SearchAddon: 'readonly', WebLinksAddon: 'readonly',
        WebglAddon: 'readonly', SerializeAddon: 'readonly', Unicode11Addon: 'readonly',
      },
    },
    // Top-level names are checked across all the scripts by app/unused-top-level; no-unused-vars checks the rest.
    plugins: { app: appRules },
    rules: { 'no-unused-vars': ['error', { vars: 'local', argsIgnorePattern: '^_' }], 'app/unused-top-level': 'error' },
  },
  ...appScripts.map(({ file }) => ({
    files: [file],
    languageOptions: { globals: Object.fromEntries(appScripts.filter((o) => o.file !== file).flatMap((o) => o.names).map((n) => [n, 'writable'])) },
  })),
];
