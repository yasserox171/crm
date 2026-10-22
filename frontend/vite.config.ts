import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// In development the Django API runs separately; Vite proxies it so the
// browser sees a single origin (session + CSRF cookies just work).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_PROXY ?? 'http://127.0.0.1:8000'
  const proxy = Object.fromEntries(
    ['/api', '/admin', '/static', '/media'].map((path) => [path, { target, changeOrigin: false }]),
  )
  return {
    plugins: [react()],
    server: { port: Number(env.VITE_PORT ?? 5173), proxy },
    preview: { proxy },
  }
})
