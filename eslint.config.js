// One ESLint flat config for the whole monorepo. Each workspace runs `eslint .`,
// and ESLint resolves this file by walking up from the linted files.
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.next/',
    '**/coverage/',
    '**/.turbo/',
    'packages/db/src/generated/',
    'apps/web/next-env.d.ts',
  ]),

  js.configs.recommended,

  // Type-aware TypeScript rules for every package.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Nest injects dependencies by constructor parameter type, and decorator
      // metadata needs value imports, so type-only imports can't be forced.
      '@typescript-eslint/consistent-type-imports': 'off',
      // Nest modules are classes that only hold decorators.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },

  // Node code: API, worker, packages and root config files.
  {
    files: ['apps/api/**', 'apps/worker/**', 'packages/**', '*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // Next.js app: Next, React, hooks and accessibility rules.
  {
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
    extends: [nextVitals],
    settings: { next: { rootDir: `${import.meta.dirname}/apps/web` } },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  // Tests: allow the looser patterns test code needs.
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Plain JS files (like this one) are not part of any tsconfig.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Must be last: turns off stylistic rules that conflict with Prettier.
  prettier,
);
