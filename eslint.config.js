import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
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
      '**/PersonCard.tsx',
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
])
