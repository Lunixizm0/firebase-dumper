import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

import security from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import promise from "eslint-plugin-promise";
import node from "eslint-plugin-n";
import regexp from "eslint-plugin-regexp";
import noSecrets from "eslint-plugin-no-secrets";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "firebase_dump/**",
      "coverage/**",
      "dist/**",
      "build/**",
      ".test-tmp-*/**"
    ]
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node
    },

    plugins: {
      security,
      sonarjs,
      promise,
      n: node,
      regexp,
      "no-secrets": noSecrets
    },

    rules: {
      ...security.configs.recommended.rules,
      ...sonarjs.configs.recommended.rules,
      ...promise.configs.recommended.rules,
      ...regexp.configs["flat/recommended"].rules,

      // JS/TS
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true
        }
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",

      // Security
      "security/detect-child-process": "error",
      "security/detect-non-literal-fs-filename": "warn",
      "security/detect-object-injection": "off",

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
  },

  {
    files: ["test/**/*.ts"],
    rules: {
      "security/detect-child-process": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/publicly-writable-directories": "off",
      "no-control-regex": "off"
    }
  },

  {
    files: ["eslint.config.js", "vitest.config.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node
    }
  }
);
