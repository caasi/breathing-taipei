import { useEffect, useState } from 'react'

type Store = { get: (key: string) => string | null; set: (key: string, value: string) => void }

const URL_STORE: Store = {
  get: key => new URLSearchParams(location.search).get(key),
  set: (key, value) => {
    const q = new URLSearchParams(location.search)
    q.set(key, value)
    history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`)
  },
}
// Every page of the same GitHub Pages user shares one origin, so the keys carry the project name.
// Storage can be missing or throw (a private window, blocked site data); the setting then lasts for the page only.
const LOCAL_STORE: Store = {
  get: key => { try { return localStorage.getItem(`breathing-taipei.${key}`) } catch { return null } },
  set: (key, value) => { try { localStorage.setItem(`breathing-taipei.${key}`, value) } catch { /* the page keeps the value */ } },
}

/** The stored text is outside input: a value that does not parse falls back to the default. */
function useSetting<T>(store: Store, key: string, fallback: T, parse: (s: string) => T | undefined, format: (v: T) => string) {
  const [value, setValue] = useState<T>(() => {
    const raw = store.get(key)
    return raw === null ? fallback : parse(raw) ?? fallback
  })
  useEffect(() => store.set(key, format(value)), [key, value])
  return [value, setValue] as const
}

/** A policy setting: it starts from ?key= in the URL and writes itself back, so a link reproduces the scenario. */
export const useQuery = <T>(key: string, fallback: T, parse: (s: string) => T | undefined, format: (v: T) => string = String) =>
  useSetting(URL_STORE, key, fallback, parse, format)
/**
 * A display setting: it belongs to this viewer and device, so it stays in this browser and not in a shared link.
 * An old link can still carry the key (display settings were in the URL before 2026-10-24); it is removed, unread.
 */
export function useStored<T>(key: string, fallback: T, parse: (s: string) => T | undefined, format: (v: T) => string = String) {
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    if (!q.has(key)) return
    q.delete(key)
    const rest = q.toString() // not q.size: Safari before 17 has no size, and the test would drop every key
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`)
  }, [key])
  return useSetting(LOCAL_STORE, key, fallback, parse, format)
}

export const oneOf = <T extends string | number>(options: readonly T[]) => (s: string) =>
  options.find(o => String(o) === s)
export const bool = (s: string) => (s === '1' ? true : s === '0' ? false : undefined)
export const fromBool = (b: boolean) => (b ? '1' : '0')
/** A number from min to max on the steps of a range input. */
export const onSteps = (min: number, max: number, step: number) => (s: string) => {
  const v = Number(s), n = (v - min) / step
  return s.trim() !== '' && v >= min && v <= max && Math.abs(n - Math.round(n)) < 1e-9 ? v : undefined
}
/**
 * A comma list of known names. Unknown names drop out; a list that names something but nothing
 * known is not valid. An empty list is a valid empty selection, so it survives a round trip.
 */
export const setOf = (options: readonly string[]) => (s: string) => {
  if (s === '') return new Set<string>()
  const set = new Set(s.split(',').filter(k => options.includes(k)))
  return set.size ? set : undefined
}
