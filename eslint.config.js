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
    files: ['eslint.config.js'],
    rules: {
      'n/no-unpublished-import': 'off',
    },
  },
  {
    ignores: ['dist/**'],
  }
)
