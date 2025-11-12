module.exports = {
  root: true,
  env: { es2023: true, node: true, browser: false },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '.vite/',
    'coverage/',
    'artifacts/',
    'client/dist/',
    'server/dist/',
    'client/src/crypto/libsignal-protocol.js',
    'client/e2e/**/*',
    'client/eslint.config.js',
  ],
  extends: [
    'eslint:recommended',
    'plugin:security/recommended-legacy',
    'plugin:import/recommended',
  ],
  plugins: ['security', 'import'],
  settings: {
    'import/extensions': ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
      },
    },
  },
  rules: {
    'no-eval': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-object-injection': 'off',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    'import/order': [
      'warn',
      {
        'newlines-between': 'always',
        alphabetize: { order: 'asc' },
      },
    ],
    'import/no-unresolved': 'error',
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "CallExpression[callee.object.name='console'][callee.property.name=/^(log|info|debug)$/] > :matches(MemberExpression,Identifier)[name=/^(req|request)$/]",
        message: 'Не логируй req.* (тела/заголовки/секреты).',
      },
      {
        selector:
          "CallExpression[callee.object.name='console'][callee.property.name=/^(log|info|debug)$/] Literal[value=/authorization|password|secret|token/i]",
        message: 'Не логируй секреты/токены/пароли.',
      },
    ],
  },
  overrides: [
    {
      files: ['client/**/*.{js,jsx,ts,tsx}'],
      env: { browser: true, node: true },
      rules: {
        'no-unused-vars': [
          'warn',
          {
            varsIgnorePattern: '^[A-Z]',
          },
        ],
      },
    },
    {
      files: ['client/src/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['libsignal-protocol*'],
                message: 'libsignal разрешён только внутри crypto/worker',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['**/*.test.{js,ts,jsx,tsx}'],
      env: { node: true, browser: true },
      rules: { 'no-console': 'off' },
    },
    {
      files: ['client/src/crypto/**'],
      rules: {
        'no-restricted-globals': ['error', 'localStorage', 'sessionStorage'],
      },
    },
    {
      files: ['client/src/crypto/worker/**/*'],
      env: { worker: true, browser: true, node: true },
      rules: { 'no-restricted-imports': 'off' },
    },
    { files: ['client/vite.config.js'], env: { node: true, browser: false } },
    { files: ['server/**/*.{js,ts}'], env: { node: true, browser: false } },
  ],
};
