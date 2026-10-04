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
    files: ["src/main/**/*.ts", "src/shared/**/*.ts"],
    rules: {
      // Im CJS-Bundle des Main-Prozesses wird ein Default-Import von
      // @turf/area zu require(...) — dem Modulobjekt statt der Funktion
      // ("area is not a function"). Unit-Tests (ESM) sehen das nicht.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value='@turf/area'] > ImportDefaultSpecifier",
          message:
            "Use the named import `{ area }` from @turf/area; the default import breaks in the main-process CJS bundle.",
        },
      ],
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
