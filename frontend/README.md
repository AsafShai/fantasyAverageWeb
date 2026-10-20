# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Testing

- `npm test` runs the Vitest unit tests (jsdom).
- `npm run test:e2e` runs the live UI tests in `e2e/` with Playwright in real Chromium,
  in two projects: `desktop` (1280×800) and `mobile` (iPhone 13, 390×844, touch).
  It starts the Vite dev server on port 5174 itself.

The backend is never called: `e2e/support/mockApi.ts` answers every request to
`http://localhost:8000/api` from the JSON in `e2e/fixtures/`, and any path without a
fixture gets a 404, so pages show their empty or error state. Import `test` and `expect`
from `e2e/support/test.ts`. That version mocks the API, fixes the clock at
2026-10-19, and fails the test on any uncaught page error. Add or change a response in one test with
`mockApi(page, { '/some/path': body })`.

Useful flags: `--project=mobile`, `--headed`, `--ui`, `-g "<test name>"`. On a failure, the
trace and screenshot are saved under `test-results/`.

First run on a new machine: `npx playwright install chromium`. In Claude Code cloud sessions
Chromium is preinstalled at `/opt/pw-browsers`, and `@playwright/test` is pinned to the
matching version (1.56.1), so skip the install there.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      ...tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      ...tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      ...tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
