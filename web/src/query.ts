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
    history.replaceState(null, '', `${location.pathname}?${q}`)
  }, [key, value])
  return [value, setValue] as const
}

export const oneOf = <T extends string | number>(options: readonly T[]) => (s: string) =>
  options.find(o => String(o) === s)
export const bool = (s: string) => (s === '1' ? true : s === '0' ? false : undefined)
export const fromBool = (b: boolean) => (b ? '1' : '0')
