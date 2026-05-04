import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Patched liveline must not be frozen in node_modules/.vite/deps or session-fade changes vanish.
  optimizeDeps: {
    exclude: ['liveline'],
  },
  server: {
    proxy: {
      // Proxy /api/* to Vercel dev server (run `vercel dev` on port 3000)
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
