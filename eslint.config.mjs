import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Lint rules for lambdas/ and eval/. Formatting is Prettier's job (npm run format);
// eslint-config-prettier turns off the ESLint rules that would argue with it.
export default defineConfig(
    { ignores: ['**/node_modules/', '**/.aws-sam/', '**/coverage/', 'eval/reports/'] },
    js.configs.recommended,
    tseslint.configs.recommended,
    { languageOptions: { globals: globals.node } },
    prettier,
);
