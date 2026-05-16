'use strict';

/**
 * lint-staged config.
 * - Filters out files under tools/eslint-rules/ (intentionally ignored in
 *   .eslintrc.cjs since they're a CJS ESLint plugin, not app code).
 * - Filters out dotfiles, which ESLint 8 ignores by default when given
 *   explicit paths anyway (e.g. .eslintrc.cjs, .dependency-cruiser.cjs).
 */
const path = require('node:path');

function isEslintable(file) {
  const base = path.basename(file);
  if (base.startsWith('.')) return false;
  if (file.includes(`${path.sep}tools${path.sep}eslint-rules${path.sep}`)) return false;
  return true;
}

module.exports = {
  '*.{ts,tsx,js,cjs,mjs}': (files) => {
    const lintable = files.filter(isEslintable);
    const cmds = [];
    if (lintable.length > 0) {
      cmds.push(`eslint --max-warnings=0 --fix ${lintable.map((f) => `"${f}"`).join(' ')}`);
    }
    cmds.push(`prettier --write ${files.map((f) => `"${f}"`).join(' ')}`);
    return cmds;
  },
  '*.{json,md,yml,yaml}': (files) => `prettier --write ${files.map((f) => `"${f}"`).join(' ')}`,
};
