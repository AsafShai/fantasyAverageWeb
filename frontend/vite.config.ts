import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        codeSplitting: {
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
