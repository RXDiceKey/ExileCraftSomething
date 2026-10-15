// Kingsmarch recombinator, unpredictable (random) mode only (D31), with the 3.26+ rules in PLAN §3.1:
// Butsicles' 3.25 measurements + 3.26 changes, PoE Wiki "Recombinator".
import { BASES, MODS } from './data.ts'
import { modInfluence } from './influence.ts'
import { affixLimits, editable, isPrefix, itemTags, rollMod, spawnWeight, type Item, type RolledMod } from './item.ts'
import { next, pickWeighted, type Rng } from './rng.ts'

// Two magic/rare items of the same item class; corrupted, mirrored and veiled ones can't go in.
export const canRecombine = (a: Item, b: Item) => a !== b && editable(a) && editable(b)
  && BASES[a.base].cls === BASES[b.base].cls && a.rarity !== 'normal' && b.rarity !== 'normal'

export const recombinedLevel = (a: number, b: number) => Math.min(Math.floor((a + b) / 2 + 2), Math.max(a, b))

// Exclusive mods (essence-only, beast aspects and other bench crafts incl. meta-crafts, elevated, unveiled): at most one
// makes it, and a side's exclusive mods count as one for its pool size (3.26).
// Breach, Delve and Incursion drop-only options too (PoE Wiki, Recombinator: exclusive modifiers).
export const isExclusive = (m: RolledMod) => !!m.crafted || !!MODS[m.id].essenceOnly || !!MODS[m.id].elev || MODS[m.id].dom === 'unveiled'
  || !!MODS[m.id].drop

// How many mods a side keeps, by its pool size (Butsicles' 3.25 table, rows normalised).
const KEEP: Record<number, number[]> = {
  1: [41, 59], 2: [0, 67, 33], 3: [0, 39, 52, 10], 4: [0, 11, 59, 31], 5: [0, 0, 43, 57], 6: [0, 0, 28, 72],
}
function keepCount(pool: number, rng: Rng): number {
  if (pool <= 0) return 0
  const row = KEEP[Math.min(6, pool)]
  const total = row.reduce((s, x) => s + x, 0)
  let r = next(rng) * total
  for (let k = 0; k < row.length; k++) if ((r -= row[k]) < 0) return k
  return row.length - 1
}

interface Entry { m: RolledMod; from: Item }
const poolSize = (side: Entry[]) => side.filter((e) => !isExclusive(e.m)).length + (side.some((e) => isExclusive(e.m)) ? 1 : 0)

// ponytail: the result is always rare; pick weight is the mod's spawn weight on the item it came from (1000 for mods that
// never roll naturally), per the post-3.25 measurements, to be tuned.
// Fractured mods (PoE Wiki, Recombinator): dropped from the pool before the counts are rolled unless the chosen base is
// the fractured item; then they're picked like any other mod and stay fractured, so the result keeps the same number of
// fractured mods or fewer. The other item's fractured mods never come along (no more fractured mods than an input).
export function recombine(a: Item, b: Item, rng: Rng): Item {
  const base = next(rng) < 0.5 ? a : b
  const result: Item = {
    base: base.base, ilvl: recombinedLevel(a.ilvl, b.ilvl), rarity: 'rare', implicits: base.implicits, explicits: [],
    influences: base.influences, ...(base.quality && { quality: base.quality }),
  }
  const entries: Entry[] = [a, b].flatMap((item) => item.explicits.filter((m) => !m.fractured || item === base).map((m) => ({ m, from: item })))
  let pre = entries.filter((e) => isPrefix(e.m))
  let suf = entries.filter((e) => !isPrefix(e.m))

  // How many to keep on each side.
  let np: number, ns: number
  if (poolSize(pre) === 1 && poolSize(suf) === 1) {
    const r = next(rng) * 3 // 1 prefix / 1 suffix / both, a third each
    np = r < 1 || r >= 2 ? 1 : 0
    ns = r >= 1 ? 1 : 0
  } else {
    do {
      np = keepCount(poolSize(pre), rng)
      ns = keepCount(poolSize(suf), rng)
    } while (np + ns === 0 && pre.length + suf.length > 0)
  }
  // Never more than the result's base allows (Geodesic Ring 4/2, Helical Ring 1/4, ...).
  const limits = affixLimits(result)
  np = Math.min(np, limits.prefix)
  ns = Math.min(ns, limits.suffix)

  // The result can't hold mods its base couldn't roll (influence mods on a plain base, ...): such a pick is just lost.
  // Bench crafts and essence mods never roll but fit any base of the class; elevated mods need their influence.
  const tags = itemTags({ ...result, explicits: [] })
  // Drop-only options move to other bases of the class (Grasping Mail options onto any body armour).
  const fits = (m: RolledMod) => m.crafted || MODS[m.id].essenceOnly || MODS[m.id].drop ? true
    : MODS[m.id].elev ? result.influences.includes(modInfluence(m.id)!) : spawnWeight(m.id, tags) > 0
  const weight = (e: Entry) => spawnWeight(e.m.id, itemTags({ ...e.from, explicits: [] })) || 1000
  const out: RolledMod[] = []
  const groups = new Set<string>()
  let exclusiveTaken = false
  const take = (side: 'pre' | 'suf') => {
    const pool = side === 'pre' ? pre : suf
    const e = pickWeighted(rng, pool, weight)
    if (!e) return
    const drop = (x: Entry) => x === e || MODS[x.m.id].grp.some((g) => MODS[e.m.id].grp.includes(g))
      || (isExclusive(e.m) && isExclusive(x.m))
    pre = pre.filter((x) => !drop(x))
    suf = suf.filter((x) => !drop(x))
    if (!fits(e.m) || MODS[e.m.id].grp.some((g) => groups.has(g)) || (exclusiveTaken && isExclusive(e.m))) return
    MODS[e.m.id].grp.forEach((g) => groups.add(g))
    exclusiveTaken ||= isExclusive(e.m)
    // Values keep their tier but roll again; crafted mods stay crafted, fractured mods stay exactly as they are.
    out.push(e.m.fractured ? e.m : { ...rollMod(e.m.id, rng), ...(e.m.crafted && { crafted: true as const }) })
  }
  // Fill order: 50/50 when both sides have ordinary mods; a side with only exclusive mods goes last (3.26).
  const onlyExclusive = (pool: Entry[]) => pool.length > 0 && pool.every((e) => isExclusive(e.m))
  const preFirst = onlyExclusive(pre) !== onlyExclusive(suf) ? !onlyExclusive(pre) : next(rng) < 0.5
  const order: ('pre' | 'suf')[] = preFirst ? ['pre', 'suf'] : ['suf', 'pre']
  for (const side of order) for (let k = 0; k < (side === 'pre' ? np : ns); k++) take(side)
  return { ...result, explicits: out }
}

// Cost in chaos (D25: Kingsmarch gold isn't this game's gold, so it's kept low): a few chaos plus more for high tiers;
// mixing in low-tier mods makes it cheaper, like in the game. ponytail: shape only, tune in P7.
export function recombineCostChaos(a: Item, b: Item, tierOf: (item: Item, id: string) => number): number {
  const mods = [a, b].flatMap((i) => i.explicits.map((m) => tierOf(i, m.id)))
  if (!mods.length) return 3
  const q = (t: number) => (t <= 0 ? 1.2 : [1, 0.8, 0.6, 0.45][t - 1] ?? 0.3)
  return Math.round(3 + 20 * (mods.reduce((s, t) => s + q(t), 0) / mods.length))
}
