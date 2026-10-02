import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { commitMeta } from './commitMeta'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    commitMeta(),
  ],
  build: {
    rollupOptions: {
      output: {
        codeSplitting: {
          // Capture only the matched packages, not everything they depend on:
          // recharts depends on @reduxjs/toolkit/react-redux, which the app's
          // store needs at startup, so capturing dependencies dragged the
          // whole chart library into every first page load.
          includeDependenciesRecursively: false,
          groups: [
            { name: 'recharts', test: /node_modules[\\/]recharts/ },
            { name: 'react-table', test: /node_modules[\\/]@tanstack[\\/]react-table/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    maxWorkers: 1,
    fileParallelism: false,
  },
})
