import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'src/generated'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_`-prefixed names mark values deliberately left out (e.g. stripping a field from an object).
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
);
