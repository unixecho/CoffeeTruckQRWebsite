import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Flat config, using the configs `eslint-config-next` 16 exports directly.
 *
 * Not `FlatCompat`: that path re-validates the config through the legacy
 * eslintrc schema, which cannot serialise the plugin graph these ship and
 * fails with a circular-structure error before a single file is linted.
 */
const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "legacy/**",
      ".next/**",
      "node_modules/**",
      "graphify-out/**",
      "scripts/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      /* Derive state during render; `useEffect` is for real external systems
         only. A missing dependency here is almost always a state sync that
         should not have been an effect at all. */
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
