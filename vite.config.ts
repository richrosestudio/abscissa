import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Patched liveline must not be frozen in node_modules/.vite/deps or session-fade changes vanish.

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  /** Proxy `/api` during `npm run dev`. Override with VITE_API_PROXY_TARGET (e.g. http://localhost:3000 when using `vercel dev`). */
  const apiProxyTarget =
    env.VITE_API_PROXY_TARGET ||
    env.API_PROXY_TARGET ||
    'https://abscissa.live'

  return {
    plugins: [react()],
    optimizeDeps: {
      exclude: ['liveline'],
    },
    server: {
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
