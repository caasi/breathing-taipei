// mulberry32: seeded so a run can be replayed and a fuzz failure reproduced.
export const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Index drawn in proportion to weights; uniform when every weight is 0.
export const pick = (weights: ArrayLike<number>, r: number): number => {
  let total = 0
  for (let i = 0; i < weights.length; i++) total += weights[i]
  if (total <= 0) return Math.min(weights.length - 1, Math.floor(r * weights.length))
  let x = r * total
  for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) < 0) return i
  return weights.length - 1
}
