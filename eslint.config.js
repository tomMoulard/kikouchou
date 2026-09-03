import js from '@eslint/js'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

import kikoushou from './eslint-rules/index.js'

export default defineConfig([
  globalIgnores(['.worktrees', 
    'dist',
    'coverage',
    'playwright-report',
    'test-results',
    'src/gen',
    // Deno, not the browser: `Deno.*` globals and jsr:/npm: specifiers that this
    // config's parser and globals cannot resolve. Deno has its own linter.
    'supabase/functions',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      // Accessibility. AGENTS.md § Accessibility asks for labelled icon-only
      // buttons, `aria-hidden` on decorative icons and `htmlFor`/`id` on form
      // fields; until now nothing checked any of it, and a11y regressions were
      // found by an axe scan in Playwright — after the code had shipped, and
      // only on the pages the scan happened to visit.
      jsxA11y.flatConfigs.recommended,
    ],
    plugins: { kikoushou },
    linterOptions: {
      // A disable comment that no longer suppresses anything is a claim about
      // the code that has quietly stopped being true. Loud, not silent.
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Allow exporting hooks alongside components in context files
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowExportNames: ['use*', '*Context'] },
      ],

      // Theme tokens over raw colours (AGENTS.md § Styling). A cleanup pass had
      // to convert 456 palette utilities by hand; this is what stops the 457th.
      'kikoushou/no-raw-palette-class': 'error',
      // ...and what keeps every exemption above honest: the rule below is the
      // reason an inline disable is preferable to a path exclusion here.
      'kikoushou/require-disable-description': 'error',

      // Beyond jsx-a11y's `recommended`, three rules that map onto AGENTS.md's
      // own checklist and cost nothing today — each was measured at zero
      // violations on `main` before being switched on.
      //
      // `control-has-associated-label` is AGENTS.md's "ARIA labels on all
      // icon-only buttons", as far as a linter can take it. The options are
      // `recommended`'s own, minus its `includeRoles: ['alert', 'dialog']` —
      // that whitelist is what stops the rule ever looking at a button, which
      // is the one thing this project wants it to look at. `depth: 3` reaches
      // an icon inside a `<span>` wrapper.
      //
      // What it catches: `<button />` with no children, and `<button><svg
      // aria-hidden /></button>`. What it cannot: `<button><X /></button>`
      // where `X` is a lucide component, because a linter cannot know whether a
      // custom component renders text. That case is still covered — by the
      // `button-name` rule in the axe scan in `e2e/accessibility.spec.ts` —
      // just at a later gate.
      'jsx-a11y/control-has-associated-label': [
        'error',
        {
          depth: 3,
          ignoreElements: [
            'audio',
            'canvas',
            'embed',
            'input',
            'textarea',
            'tr',
            'video',
          ],
          ignoreRoles: [
            'grid',
            'listbox',
            'menu',
            'menubar',
            'radiogroup',
            'row',
            'tablist',
            'toolbar',
            'tree',
            'treegrid',
          ],
        },
      ],
      // The inverse of the decorative-icon rule: `aria-hidden` on something
      // focusable hides it from a screen reader while leaving it in the tab
      // order, which is worse than either alternative.
      'jsx-a11y/no-aria-hidden-on-focusable': 'error',
      // "Click here" / "read more" are useless in a link list read out of
      // context, which is how screen-reader users navigate.
      'jsx-a11y/anchor-ambiguous-text': 'error',
      //
      // Deliberately NOT enabled: `jsx-a11y/prefer-tag-over-role`, 62
      // violations, effectively all of them `role="button"` on a Radix `asChild`
      // trigger or `role="region"`/`role="radiogroup"` where no HTML tag
      // carries the semantics. Landing it would mean 62 disable comments
      // teaching people that disable comments are routine, which is the exact
      // habit the two rules above are here to break.
    },
  },
  // Disable React Compiler rules for context files that use intentional patterns
  {
    files: ['**/contexts/*.tsx'],
    rules: {
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // Disable React Compiler rules for complex components with intentional patterns
  {
    files: [
      '**/DateRangePicker.tsx',
      '**/CalendarPage.tsx',
      '**/EventDetailDialog.tsx',
      '**/PersonForm.tsx',
      '**/QuickAssignmentDialog.tsx',
      '**/RoomAssignmentSection.tsx',
      '**/RoomCard.tsx',
      '**/RoomListPage.tsx',
      '**/ShareDialog.tsx',
      '**/UpcomingPickups.tsx',
      '**/TransportListPage.tsx',
      '**/TripCard.tsx',
    ],
    rules: {
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
    },
  },
  // Disable for hooks that use intentional patterns
  {
    files: ['**/hooks/*.ts'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // Disable fast refresh warning for UI component files that export variants
  {
    files: ['**/components/ui/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Disable fast refresh warning for context files (export providers + hooks + types)
  {
    files: ['**/contexts/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Disable fast refresh warning for route definition files
  {
    files: ['**/routes.tsx', '**/router.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Disable fast refresh warning for TripCard (exports utility functions)
  {
    files: ['**/TripCard.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Disable fast refresh warning for components that export utilities/types alongside
  {
    files: [
      '**/DirectionsButton.tsx',
      '**/RoomIconPicker.tsx',
      '**/EventDetailDialog.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Disable fast refresh warning for test utilities (not subject to HMR)
  {
    files: ['**/test/**/*.tsx', '**/test/**/*.ts', '**/*.test.tsx', '**/*.test.ts'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
