const tseslint = require("@electron-toolkit/eslint-config-ts");
const reactHooks = require("eslint-plugin-react-hooks");
const jsxA11y = require("eslint-plugin-jsx-a11y");

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
    // Accessibility (WCAG 2.2 AA / EN 301 549): static checks for labels,
    // roles, keyboard access and alt texts. axe-core covers the rendered
    // pages in the end-to-end tests (e2e/accessibility.spec.ts).
    files: ["src/renderer/**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // `role` on our own components (MessageBubble) is a prop, not ARIA.
      "jsx-a11y/aria-role": ["error", { ignoreNonDOM: true }],
      // Focusing the field of an inline editor the user just opened (rename,
      // edit) is deliberate focus management, not focus stolen on page load.
      // Plain DOM elements are still checked.
      "jsx-a11y/no-autofocus": ["error", { ignoreNonDOM: true }],
      // Radix checkboxes render a <button>; a wrapping <label> labels it.
      "jsx-a11y/label-has-associated-control": [
        "error",
        { controlComponents: ["Checkbox", "Switch"], depth: 3 },
      ],
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
