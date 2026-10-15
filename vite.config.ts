import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/ExileCraftSomething/',
  publicDir: 'assets', // currency icons + Faustus voice, served as-is
  plugins: [react()],
})
