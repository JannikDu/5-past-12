import js from '@eslint/js';
import react from '@eslint-react/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', '.astro/**', '.devswarm-temp/**']),
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx,astro}'],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.{ts,tsx,astro}'],
    extends: [tseslint.configs.recommended],
  },
  astro.configs.recommended,
  {
    files: ['**/*.astro'],
    processor: 'astro/client-side-ts',
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    extends: [react.configs['recommended-typescript'], reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
