const tseslint = require("@electron-toolkit/eslint-config-ts");
const reactHooks = require("eslint-plugin-react-hooks");

module.exports = tseslint.config(
  { ignores: ["out/**", "release/**", "resources/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Nur die klassischen Hook-Regeln — v7 bündelt in "recommended" zusätzlich
      // die React-Compiler-Regeln (Purity, set-state-in-effect, …), die auch auf
      // generierte shadcn/ui-Dateien und etablierte Effect-Patterns anschlagen.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    rules: {
      // Präfix-Konvention für bewusst ungenutzte Parameter/Variablen (z. B. Callback-Signaturen).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
