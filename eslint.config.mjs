import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      "**/*.config.{js,mjs,cjs,ts}",
      "**/*.cjs", // CommonJS build araçları (ör. electron-builder hook'ları)
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node ortamı script'leri (build/dev yardımcıları), kök ve paket düzeyinde.
    files: ["scripts/**/*.mjs", "**/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        Buffer: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
