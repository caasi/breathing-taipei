/** Fetches a data file next to the app. A missing file is an error, not an empty map. */
export const getJson = async (name: string) => {
  const r = await fetch(`${import.meta.env.BASE_URL}${name}`)
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`)
  return r.json()
}
