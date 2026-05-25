// @ts-check
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginN from 'eslint-plugin-n'
import pluginPromise from 'eslint-plugin-promise'

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: {
      n: pluginN,
      promise: pluginPromise,
    },
    rules: {
      'promise/param-names': 'error',
      'n/no-process-exit': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    ignores: ['dist/**'],
  }
)
