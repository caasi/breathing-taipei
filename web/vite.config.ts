import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
// The commit of the build, shown on the page: GITHUB_SHA on CI, the checkout's HEAD locally.
const commit = process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD').toString().trim()

// GitHub Pages serves the site under /breathing-taipei/; the Pages workflow sets BASE, and dev keeps /.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE ?? '/',
  define: { __VERSION__: JSON.stringify(version), __COMMIT__: JSON.stringify(commit) },
})
