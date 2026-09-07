import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const SERVER = 'http://localhost:8787'

// In dev, Vite serves the client and forwards the API and the WebSocket to
// the game server. In production the game server serves `dist/` itself, so
// there is one origin and one Railway service.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/ws': { target: SERVER, ws: true },
    },
  },
})
