import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Flat config. `eslint-config-next` ships native flat exports, so these are
 * spread directly rather than bridged through FlatCompat.
 */
const config = [
  {
    ignores: [".next/**", "node_modules/**", "out/**", "data/**", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Deliberate no-ops — blocked storage, a corrupt cached value — are
      // written as empty catches with a comment saying why swallowing is right.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];

export default config;
