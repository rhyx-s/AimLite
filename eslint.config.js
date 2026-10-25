import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src-tauri/target/**', 'release/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.name='eval']", message: 'No eval.' },
        { selector: "NewExpression[callee.name='Function']", message: 'No Function constructor.' },
        { selector: "AssignmentExpression[left.property.name='innerHTML']", message: 'Use textContent / DOM nodes, not innerHTML.' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' } },
  },
);
