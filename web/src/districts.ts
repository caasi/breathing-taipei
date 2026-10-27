/** The districts of the villages in the order they first come, and the index of the district of each village. */
export const groupBy = (districtOf: string[]) => {
  const names = [...new Set(districtOf)], index = new Map(names.map((n, d) => [n, d]))
  return { names, of: Int32Array.from(districtOf, n => index.get(n)!) }
}

/** A value of each village, added up by district. */
export const sumBy = (group: ReturnType<typeof groupBy>, a: ArrayLike<number>) => {
  const out = new Uint32Array(group.names.length)
  for (let i = 0; i < a.length; i++) out[group.of[i]] += a[i]
  return out
}

/**
 * The change of each node per hour over `minutes`, as a share of its residents. For a district, give the sums of its
 * villages: the rate of a district is its whole change over its whole residents, not a mean of the rates of its villages.
 */
export const changeRate = (now: ArrayLike<number>, then: ArrayLike<number>, residents: ArrayLike<number>, minutes: number) => {
  const out = new Float32Array(now.length), perHour = 60 / minutes
  for (let i = 0; i < out.length; i++) out[i] = (now[i] - then[i]) * perHour / Math.max(1, residents[i])
  return out
}
