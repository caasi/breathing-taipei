// The data files are not fingerprinted and GitHub Pages caches them for 10 minutes, so the commit in the URL keeps a
// new build from reading the files of an older one: a file whose shape changed can break the render.
const url = (name: string) => `${import.meta.env.BASE_URL}${name}?v=${__COMMIT__}`

/** Fetches a data file next to the app. A missing file is an error, not an empty map. */
export const getJson = async (name: string) => {
  const r = await fetch(url(name))
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`)
  return r.json()
}

/** Fetches an optional Uint16 file next to the app; undefined when it is missing. */
export const getOptional = async (name: string) => {
  const r = await fetch(url(name))
  // The Vite dev server answers a missing file with index.html and status 200.
  if (!r.ok || r.headers.get('content-type')?.includes('html')) return undefined
  const buf = await r.arrayBuffer()
  return buf.byteLength % 2 ? undefined : new Uint16Array(buf)
}
