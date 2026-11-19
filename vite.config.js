import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' },
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
  preview: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' },
  },
})
