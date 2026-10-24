import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// GitHub Pages serves the site under /breathing-taipei/; the Pages workflow sets BASE, and dev keeps /.
export default defineConfig({ plugins: [react()], base: process.env.BASE ?? '/' })
