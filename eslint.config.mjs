import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: ["legacy/**", ".next/**", "node_modules/**", "graphify-out/**"] },
  {
    rules: {
      /* Derive state during render; `useEffect` is for real external systems
         only. Ported from the 3D Prints house rules. */
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];

export default config;
