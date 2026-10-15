// Seeded PRNG (mulberry32). The state is a plain object so it can live in the save file:
// reloading the page replays the same rolls instead of rerolling them.
export interface Rng {
  s: number
}

export function next(rng: Rng): number {
  let t = (rng.s = (rng.s + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const int = (rng: Rng, min: number, max: number) => min + Math.floor(next(rng) * (max - min + 1))

export function pickWeighted<T>(rng: Rng, items: T[], weight: (x: T) => number): T | undefined {
  const ws = items.map(weight)
  let r = next(rng) * ws.reduce((a, b) => a + b, 0)
  for (let i = 0; i < items.length; i++) if ((r -= ws[i]) < 0) return items[i]
  return undefined
}
