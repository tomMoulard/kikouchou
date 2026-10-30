/**
 * @fileoverview Types for the project-local ESLint plugin.
 *
 * The implementation is plain JavaScript because `eslint.config.js` imports it
 * from Node with no transpiler; this declaration is what lets the Vitest suite
 * feed the rules to ESLint's `RuleTester` under `tsc -b`.
 *
 * @module eslint-rules
 */

import type { Rule } from 'eslint';

declare const plugin: {
  meta: { name: string; version: string };
  rules: {
    'no-raw-palette-class': Rule.RuleModule;
    'require-disable-description': Rule.RuleModule;
  };
};

export default plugin;
