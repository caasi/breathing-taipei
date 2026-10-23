import { useEffect, useState } from 'react'

/**
 * A setting that starts from ?key= in the URL and writes itself back, so a link reproduces the view.
 * The URL is outside input: a value that does not parse falls back to the default.
 */
export function useQuery<T>(key: string, fallback: T, parse: (s: string) => T | undefined, format: (v: T) => string = String) {
  const [value, setValue] = useState<T>(() => {
    const raw = new URLSearchParams(location.search).get(key)
    return raw === null ? fallback : parse(raw) ?? fallback
  })
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    q.set(key, format(value))
    history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`)
  }, [key, value])
  return [value, setValue] as const
}

export const oneOf = <T extends string | number>(options: readonly T[]) => (s: string) =>
  options.find(o => String(o) === s)
export const bool = (s: string) => (s === '1' ? true : s === '0' ? false : undefined)
export const fromBool = (b: boolean) => (b ? '1' : '0')
/**
 * A comma list of known names. Unknown names drop out; a list that names something but nothing
 * known is not valid. An empty list is a valid empty selection, so it survives a round trip.
 */
export const setOf = (options: readonly string[]) => (s: string) => {
  if (s === '') return new Set<string>()
  const set = new Set(s.split(',').filter(k => options.includes(k)))
  return set.size ? set : undefined
}
