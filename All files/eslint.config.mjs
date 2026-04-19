import nextConfig from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...(Array.isArray(nextConfig) ? nextConfig : [nextConfig]),
  ...(Array.isArray(nextTs) ? nextTs : [nextTs]),
  {
    rules: {
      // Allow console.warn in datagrows.ts field-count assertion
      'no-console': 'off',
      // The standard useCallback+useEffect data-fetch pattern calls setState
      // inside an async function — react-hooks v7 incorrectly flags this as
      // "synchronous" setState. The rule is too strict for this valid idiom.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
