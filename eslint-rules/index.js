/**
 * @fileoverview Project-local ESLint rules — the conventions AGENTS.md states,
 * made mechanical.
 *
 * Everything else in `eslint.config.js` is a rule being *switched off*. These
 * two are the only ones that switch something on, and they exist because the
 * two conventions they cover were each expensive to enforce by hand:
 *
 * - `no-raw-palette-class` — a cleanup pass had to convert 456 raw palette
 *   utilities to theme tokens. Nothing stopped the 457th.
 * - `require-disable-description` — an exemption with no stated reason is
 *   indistinguishable from an exemption nobody thought about, and it is the
 *   escape hatch the palette rule depends on.
 *
 * @module eslint-rules
 */

import { matchRawPalette } from './raw-palette.js';

/**
 * The `-- reason` separator ESLint itself uses to split a directive comment
 * from its description: whitespace, two or more hyphens, whitespace.
 *
 * Kept identical to ESLint's own parser so this rule can never demand a
 * description in a form ESLint would then treat as part of the rule list.
 */
const DESCRIPTION_SEPARATOR = /\s-{2,}\s/u;

/**
 * Directive comments that suppress a diagnostic and therefore owe a reason.
 *
 * Split by comment kind because ESLint itself is: a `Line` comment only carries
 * a directive in the `-line` / `-next-line` forms, so `// eslint-disable foo`
 * suppresses precisely nothing. Demanding a reason for it would send a
 * developer off to justify a comment that does not do anything; the honest
 * answer there is "delete it", and `reportUnusedDisableDirectives` is not going
 * to give it either, because ESLint never saw a directive in the first place.
 *
 * The terminator is ESLint's own `(?:\s|$)`, so `// eslint-disable-next-line:
 * no-console` — which ESLint does not parse as a directive, because the name
 * runs up against a colon rather than whitespace — is not one here either.
 */
const SUPPRESSING_DIRECTIVE = {
  Line: /^eslint-disable-(?:next-line|line)(?=\s|$)/u,
  Block: /^eslint-disable(?:-next-line|-line)?(?=\s|$)/u,
};

/**
 * Rejects Tailwind palette shades (`bg-amber-100`, `text-white`) in source
 * strings, so a colour has to come from a theme token or `statusVariants`.
 *
 * The check runs on every string literal and template chunk rather than only on
 * `className={...}`, because the class rarely sits there directly: it is nearly
 * always an argument to `cn()`, a `cva` variant table, or a ternary branch in a
 * `.variants.ts` file that has no JSX at all.
 *
 * Comments are not scanned. `AGENTS.md` and several JSDoc blocks quote palette
 * classes while explaining why not to use them; flagging prose would teach
 * people to stop writing the explanation.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const noRawPaletteClass = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw Tailwind palette classes; use theme tokens or statusVariants',
    },
    schema: [],
    messages: {
      rawPalette:
        '{{classes}} is a raw Tailwind palette shade. Use a theme token (bg-background, text-muted-foreground) or statusVariants — see AGENTS.md § Styling. If the literal colour is the requirement rather than a theme choice, keep it and say why: // eslint-disable-next-line kikouchou/no-raw-palette-class -- <reason>',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node The node the text was read from.
     * @param {string} text Source text to scan.
     */
    const check = (node, text) => {
      const classes = matchRawPalette(text);
      if (classes.length === 0) {
        return;
      }
      context.report({
        node,
        messageId: 'rawPalette',
        data: { classes: classes.map((c) => `'${c}'`).join(', ') },
      });
    };

    return {
      Literal(node) {
        if (typeof node.value !== 'string') {
          return;
        }
        // A module specifier is a path, not a class list: `./to-red.js` in an
        // import would otherwise read as a gradient stop.
        if (node.parent?.source === node) {
          return;
        }
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

/**
 * Requires every `eslint-disable*` comment to carry a `-- reason`.
 *
 * This is what makes an inline exemption better than a path exclusion in
 * `eslint.config.js`: the exclusion lives far from the code and says nothing,
 * whereas a disable comment sits on the line and has to justify itself. Without
 * this rule that justification is a habit, and habits decay.
 *
 * ESLint's own `reportUnusedDisableDirectives` (on by default in flat config)
 * covers the other half — an exemption that has stopped being needed.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const requireDisableDescription = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require a `-- reason` description on every eslint-disable directive',
    },
    schema: [],
    messages: {
      missingDescription:
        'This eslint-disable needs a reason: append " -- <why this line is an exception>", as in `eslint-disable-next-line {{example}} -- <reason>`. An exemption with no stated reason is indistinguishable from one nobody thought about.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const pattern = SUPPRESSING_DIRECTIVE[comment.type];
          if (pattern === undefined) {
            continue;
          }
          const value = comment.value.trim();
          if (!pattern.test(value)) {
            continue;
          }
          const [, ...description] = value.split(DESCRIPTION_SEPARATOR);
          if (description.join('').trim() !== '') {
            continue;
          }
          // Quote back whichever rule they disabled so the fix is copy-paste.
          // The trailing `-` strip matters for the half-written case
          // `-- ` with no reason after it: ESLint reads the hyphens as part of
          // the rule name, and echoing them back would suggest `-- -- <reason>`.
          const ruleList = value
            .replace(pattern, '')
            .replace(/\s*-{2,}\s*$/u, '')
            .trim();
          context.report({
            loc: comment.loc ?? { line: 1, column: 0 },
            messageId: 'missingDescription',
            data: { example: ruleList === '' ? 'some-rule' : ruleList },
          });
        }
      },
    };
  },
};

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: 'kikouchou', version: '1.0.0' },
  rules: {
    'no-raw-palette-class': noRawPaletteClass,
    'require-disable-description': requireDisableDescription,
  },
};

export default plugin;
