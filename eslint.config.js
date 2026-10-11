// npm run lint — bug-catching rules only (eslint:recommended), no style rules. Dev-only; not shipped.
const js = require('@eslint/js');
const globals = require('globals');

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
    // The frontend: one classic script, xterm.js and its addons loaded before it as globals
    files: ['public/app.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Terminal: 'readonly', FitAddon: 'readonly', SearchAddon: 'readonly', WebLinksAddon: 'readonly',
        WebglAddon: 'readonly', SerializeAddon: 'readonly', Unicode11Addon: 'readonly',
      },
    },
  },
];
