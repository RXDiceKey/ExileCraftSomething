// Commission board (D38): builds post orders for one slot — the base they like best and a few options they want at a
// tier or better, a deadline and a fixed reward. Delivering uses one of the day's sales and pays at the next day close,
// like a sale. Orders ask for 3 options at first and 4 from mid-run on (user).
// Reward (user): COMMISSION_BONUS x the option value Faustus gives for those options, i.e. for the plainest item that
// fills the order (its base, each option at the worst tier that still counts), on the day it's posted.
import { BASES, MODS } from '../engine/data.ts'
import { affixLimits, itemTags, newItem, rollMod, spawnWeight, type Item } from '../engine/item.ts'
import { int, pickWeighted, type Rng } from '../engine/rng.ts'
import { baseKindKeys, tierOf } from './describe.ts'
import { BUILDS, popularity, type Meta, type Slot } from './meta.ts'
import { buyableBases } from './shop.ts'
import { baseAppeal, quote, slotOf } from './value.ts'

export interface Want { stat: string; maxTier: number }
export interface Commission {
  id: number
  build: string
  slot: Slot
  classes: string[] // item classes that count
  defence?: string[] // one of these defences, if the build cares
  base?: string // the exact base asked for (older saves: any base of the classes)
  wants: Want[]
  until: number // last day to deliver
  reward: number
}

export const BOARD_MAX = 5
export const COMMISSION_DAYS = 3 // today and the next two
export const COMMISSION_BONUS = 1.5
export const WANTS_EARLY = 3
export const WANTS_LATE = 4
export const WANTS_LATE_FROM = 7 // mid-run
export const wantsOn = (day: number) => (day >= WANTS_LATE_FROM ? WANTS_LATE : WANTS_EARLY)
const BASE_TIE = 0.95 // bases within 5% of the build's favourite are just as good: one is picked at random
const MAX_TIER: Record<string, number> = { starter: 3, advanced: 2, uber: 1 }
const ILVL = 84

const classesOf = (slot: Slot) => [...new Set(buyableBases().map((b) => BASES[b].cls))].filter((c) => slotOf(c) === slot)
const hasStat = (id: string, stat: string) => MODS[id].stats.some(([s]) => s === stat)
const meetsWant = (item: Item, w: Want) => item.explicits.some((m) => hasStat(m.id, w.stat) && tierOf(item, m.id) <= w.maxTier)

export function canDeliver(item: Item, c: Commission): boolean {
  if (c.base ? item.base !== c.base : !c.classes.includes(BASES[item.base].cls)) return false
  if (c.defence && !c.defence.some((d) => baseKindKeys(item.base).defences.includes(d))) return false
  return c.wants.every((w) => meetsWant(item, w))
}

// The base this build likes best for the slot (quality and wanted fixed options); near-ties picked at random.
function favouriteBase(build: string, slot: Slot, bases: string[], rng: Rng): string {
  const scored = bases.map((b) => [b, baseAppeal(build, slot, b)] as const)
  const top = Math.max(...scored.map(([, s]) => s))
  const near = scored.filter(([, s]) => s >= top * BASE_TIE).map(([b]) => b)
  return near[int(rng, 0, near.length - 1)]
}

function makeCommission(id: number, day: number, lastDay: number, meta: Meta, rng: Rng): Commission | undefined {
  const b = pickWeighted(rng, BUILDS, (x) => popularity(meta, x.id, day))!
  const slots = Object.keys(b.slots) as Slot[]
  const slot = slots[int(rng, 0, slots.length - 1)]
  const want = b.slots[slot]!
  const classes = want.classes ?? classesOf(slot)
  const bases = buyableBases().filter((x) => classes.includes(BASES[x].cls)
    && (!want.defence || want.defence.some((d) => baseKindKeys(x).defences.includes(d))))
  if (!bases.length) return undefined
  const base = favouriteBase(b.id, slot, bases, rng)
  const ref = newItem(base, ILVL, rng)
  const tags = itemTags(ref)
  const maxTier = MAX_TIER[b.tier]
  const count = wantsOn(day)
  const room = affixLimits({ ...ref, rarity: 'rare' })
  // Options the build really wants, in random order; for each, the worst mod that still meets the tier, rolling here,
  // as long as its side has room.
  const stats = Object.entries(want.wants).filter(([, w]) => w >= 0.7).map(([s]) => s)
  for (let k = stats.length - 1; k > 0; k--) {
    const j = int(rng, 0, k)
    ;[stats[k], stats[j]] = [stats[j], stats[k]]
  }
  const picked: string[] = []
  const wants: Want[] = []
  for (const stat of stats) {
    if (wants.length === count) break
    const fits = Object.keys(MODS).filter((id) => {
      const m = MODS[id]
      return (m.gen === 'prefix' || m.gen === 'suffix') && !m.dom && !m.essenceOnly && !m.elev && hasStat(id, stat)
        && m.lvl <= ILVL && spawnWeight(id, tags) > 0 && tierOf(ref, id) <= maxTier
        && !picked.some((p) => MODS[p].grp.some((g) => m.grp.includes(g)))
        && picked.filter((p) => MODS[p].gen === m.gen).length < (m.gen === 'prefix' ? room.prefix : room.suffix)
    })
    if (!fits.length) continue
    const worst = fits.reduce((a, x) => (tierOf(ref, x) > tierOf(ref, a) ? x : a))
    picked.push(worst)
    wants.push({ stat, maxTier })
  }
  if (wants.length < count) return undefined
  const plainest: Item = { ...ref, rarity: 'rare', explicits: picked.map((m) => rollMod(m, rng)) }
  const c: Commission = {
    id, build: b.id, slot, classes, ...(want.defence && { defence: want.defence }), base, wants,
    until: Math.min(lastDay, day + COMMISSION_DAYS - 1), reward: 0,
  }
  return { ...c, reward: Math.round(COMMISSION_BONUS * quote(plainest, 'en', day, meta).optionValue) }
}

// Start of a day: expired orders go, one to three new ones come (up to BOARD_MAX).
export function refreshBoard(board: Commission[], day: number, lastDay: number, meta: Meta, rng: Rng): Commission[] {
  const out = board.filter((c) => c.until >= day)
  const n = int(rng, 1, 3)
  for (let k = 0, tries = 0; k < n && out.length < BOARD_MAX && tries < 20; tries++) {
    const c = makeCommission(day * 100 + tries, day, lastDay, meta, rng)
    if (c) { out.push(c); k++ }
  }
  return out
}
