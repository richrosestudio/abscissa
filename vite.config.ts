import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Patched liveline must not be frozen in node_modules/.vite/deps or session-fade changes vanish.

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  /** When `vercel dev` is not running, set VITE_API_PROXY_TARGET or API_PROXY_TARGET to your deployed origin (e.g. https://myapp.vercel.app) so /api routes still resolve. */
  const apiProxyTarget =
    env.VITE_API_PROXY_TARGET ||
    env.API_PROXY_TARGET ||
    'http://localhost:3000'

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
