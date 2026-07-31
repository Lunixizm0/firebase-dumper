const js = require("@eslint/js");
const globals = require("globals");

const security = require("eslint-plugin-security");
const sonarjs = require("eslint-plugin-sonarjs");
const importPlugin = require("eslint-plugin-import");
const promise = require("eslint-plugin-promise");
const node = require("eslint-plugin-n");
const regexp = require("eslint-plugin-regexp");
const noSecrets = require("eslint-plugin-no-secrets");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "firebase_dump/**",
      "coverage/**",
      "dist/**",
      "build/**"
    ]
  },

  js.configs.recommended,

  {
    files: ["**/*.js"],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node
    },

    plugins: {
      security,
      sonarjs,
      import: importPlugin,
      promise,
      n: node,
      regexp,
      "no-secrets": noSecrets
    },

    rules: {
      // Recommended rule setleri
      ...security.configs.recommended.rules,
      ...sonarjs.configs.recommended.rules,
      ...promise.configs.recommended.rules,
      ...regexp.configs["flat/recommended"].rules,

      // JS
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true
        }
      ],

      // Security
      "security/detect-child-process": "error",
      "security/detect-non-literal-fs-filename": "warn",
      "security/detect-object-injection": "off",

      // Import
      "import/no-duplicates": "error",
      "import/no-self-import": "error",
      "import/no-cycle": "error",

      // Promise
      "promise/catch-or-return": "error",

      // Node
      "n/no-deprecated-api": "error",
      "n/no-process-exit": "off",

      // Regex
      "regexp/no-super-linear-backtracking": "error",
      "regexp/no-dupe-disjunctions": "error",

      // Secrets
      "no-secrets/no-secrets": [
        "warn",
        {
          tolerance: 4.2
        }
      ]
    }
  }
];
