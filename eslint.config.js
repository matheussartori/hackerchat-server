// @ts-check
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginN from 'eslint-plugin-n'
import pluginPromise from 'eslint-plugin-promise'

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  pluginN.configs['flat/recommended-module'],
  pluginPromise.configs['flat/recommended'],
  {
    rules: {
      'n/no-process-exit': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // Config and test files are not part of the published output, so they may
    // import devDependencies.
    files: ['eslint.config.js', 'vitest.config.ts', 'test/**/*.ts'],
    rules: {
      'n/no-unpublished-import': 'off',
    },
  },
  {
    ignores: ['dist/**'],
  }
)
