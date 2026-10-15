// Crafting history and the expected cost of an item (D35). Each craft records the state it was applied to, what it
// cost and how many high-efficiency useful options the result had (M, see value.ts). The expected cost to make the
// item is the base plus, for every step that still matters, cost / P(redoing that step reaches the same M or better).
// Steps whose options are all gone are forgotten (100 chaos rolls leave the last one), a scour back to a plain base
// resets everything, and restoring an imprint brings back the history it was taken with.
import type { CraftStep, Item } from '../engine/item.ts'
import type { Rng } from '../engine/rng.ts'

// The item as it stood, without its own history or imprint (keeps saves small).
export const snapshot = (i: Item): Item => {
  const { log: _log, imprint: _imprint, ...rest } = i
  return rest
}
const mods = (i: Item) => [...i.explicits, ...i.implicits]
const ids = (i: Item) => new Set(mods(i).map((m) => m.id))

export interface StepInfo {
  key: string // how to redo it (see replay)
  cost: number // gold paid
  other?: Item // the second item of an Awakener's Orb / recombinator
  extra?: number // expected cost of that second item, used up by the craft
  fixed?: boolean // always counts (a mirrored copy's mirror)
}

// `metric` counts high-efficiency useful options (value.ts highEffCount).
export function record(before: Item, after: Item, info: StepInfo, metric: (i: Item) => number): Item {
  const old = mods(before)
  const was = ids(before)
  const now = mods(after)
  // An option is the step's own unless it was already there: the same roll (engines keep untouched mods as they are),
  // or the same options with new values (divine, fracture). A chaos roll that happens to roll an option again made it.
  // So a Fracturing Orb leaves no step: it makes no option, and the price values options, not fracturing (else
  // fracturing a junk item would fetch half the orb's price back).
  const values = now.length === old.length && now.every((m) => was.has(m.id))
  const step: CraftStep = {
    ...info, ...(info.other && { other: snapshot(info.other) }),
    m: metric(after),
    before: snapshot(before),
    created: now.filter((m) => !was.has(m.id) || (!values && !old.includes(m))).map((m) => m.id),
    structural: before.rarity !== after.rarity,
  }
  return prune({ ...after, log: [...(before.log ?? []), step] })
}

// Keep a step while something it made is still on the item (each option belongs to the latest step that made it), or it
// changed the rarity, or it used up another item. Back to a plain base = no history at all.
export function prune(item: Item): Item {
  const log = item.log ?? []
  if (item.rarity === 'normal' && !item.explicits.length) return log.length ? { ...item, log: [] } : item
  const now = ids(item)
  const claimed = new Set<string>()
  const keep = log.map(() => false)
  for (let k = log.length - 1; k >= 0; k--) {
    const live = log[k].created.filter((id) => now.has(id) && !claimed.has(id))
    live.forEach((id) => claimed.add(id))
    keep[k] = live.length > 0 || log[k].structural || log[k].extra !== undefined || !!log[k].fixed
  }
  return keep.every(Boolean) ? item : { ...item, log: log.filter((_, k) => keep[k]) }
}

// ---- Probability of a step's outcome: redo it from the recorded state and count results with at least the same number
// of high-efficiency useful options, until HITS of them (p = hits / tries; tries / HITS estimates 1 / p without bias)
// or MAX_SAMPLES tries (then (hits + 1) / (tries + 2), which on average errs low on 1 / p: a rare outcome is never
// paid too much). The seed comes from the state itself, so a quote never changes, yet every state gets its own draw: with one seed for all,
// every chaos roll on a base would share the same (possibly too low) estimate of a rare outcome.
export const HITS = 20
export const MAX_SAMPLES = 4000
export type Replay = (key: string, before: Item, other: Item | undefined, rng: Rng) => Item | undefined
const pCache = new WeakMap<CraftStep, number>()
export function stepProbability(step: CraftStep, replay: Replay, metric: (i: Item) => number): number {
  const known = pCache.get(step)
  if (known !== undefined) return known
  let p = 1
  if (step.m > 0 && !DETERMINISTIC.test(step.key)) {
    const rng = { s: hash(step.key + JSON.stringify(step.before)) }
    let hits = 0
    let tries = 0
    while (hits < HITS && tries < MAX_SAMPLES) {
      const out = replay(step.key, step.before, step.other, rng)
      if (out && metric(out) >= step.m) hits++
      tries++
    }
    p = hits >= HITS ? hits / tries : (hits + 1) / (tries + 2)
  }
  pCache.set(step, p)
  return p
}
// FNV-1a
const hash = (s: string) => {
  let h = 0x811c9dc5
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 0x01000193)
  return h >>> 0
}
// The result is the player's own choice or a fixed effect: nothing to be lucky about.
const DETERMINISTIC = /^(bench:|unveil:|reveal$|mirror$|imprint$)/

export function expectedCost(item: Item, basePrice: number, replay: Replay, metric: (i: Item) => number): number {
  return (item.log ?? []).reduce((sum, s) => sum + s.cost / stepProbability(s, replay, metric) + (s.extra ?? 0), basePrice)
}
