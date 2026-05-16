'use strict';

/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: false,
  },
  plugins: ['@typescript-eslint', 'import', 'eslint-comments', '@agent-village'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:eslint-comments/recommended',
    'prettier',
  ],
  reportUnusedDisableDirectives: true,
  settings: {
    'import/resolver': {
      typescript: { project: ['packages/*/tsconfig.json', 'tools/*/tsconfig.json'] },
      node: true,
    },
  },
  ignorePatterns: [
    'node_modules',
    'dist',
    'cdk.out',
    'coverage',
    'playwright-report',
    'tools/eslint-rules/**',
    '**/*.d.ts',
  ],
  rules: {
    // ===== HARNESS HARD BOUNDS (errors, never warn) =====
    complexity: ['error', 10],
    'max-depth': ['error', 4],
    'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
    'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    'max-params': ['error', 4],
    'max-statements': ['error', 15],

    // ===== Prevent suppression =====
    // Disabling rules inline is forbidden; fix the underlying issue or open an ADR.
    'eslint-comments/no-use': [
      'error',
      { allow: ['eslint-enable', 'eslint-env', 'global', 'globals'] },
    ],
    'eslint-comments/no-unused-disable': 'error',
    '@typescript-eslint/ban-ts-comment': [
      'error',
      { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
    ],

    // ===== Type safety hardeners =====
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    'no-console': 'error',

    // ===== Custom rules with self-correcting messages =====
    '@agent-village/logger-must-use-event-envelope': 'error',
    '@agent-village/handler-must-validate-with-zod': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts'],
      rules: {
        'max-lines-per-function': 'off',
        'max-statements': 'off',
        'max-lines': 'off',
        'no-console': 'off',
      },
    },
    {
      files: ['packages/web/**/*.{ts,tsx}'],
      env: { browser: true },
      rules: {
        'no-console': ['error', { allow: ['error', 'warn'] }],
      },
    },
    {
      files: ['tools/scripts/**/*.ts', '**/*.config.{ts,cjs,mjs,js}', '**/vitest.config.ts'],
      rules: {
        'no-console': 'off',
        '@agent-village/logger-must-use-event-envelope': 'off',
      },
    },
    {
      files: ['packages/infra/**/*.ts'],
      rules: {
        // CDK construct constructors typically have >4 params via props objects, but still
        '@agent-village/handler-must-validate-with-zod': 'off',
      },
    },
  ],
};
