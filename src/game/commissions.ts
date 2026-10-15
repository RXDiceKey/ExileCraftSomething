// Commission board (D38): builds post orders for one slot — a few options they want at a tier or better, a deadline and
// a fixed reward. Delivering uses one of the day's sales and pays at the next day close, like a sale.
// Reward: the larger of COMMISSION_BONUS x Faustus's quote for the plainest item that fills it, and what filling it is
// expected to cost by the cheapest plain spam (alteration + augmentation, alchemy + scouring, or chaos): base + cost per
// try / P, with P measured by rolling it as in history.ts. Times rewardScale(day), low early and high late (user):
// early on only smart crafting pays, by the end even plain spam does.
import { CURRENCIES } from '../engine/currency.ts'
import { BASES, MODS } from '../engine/data.ts'
import { itemTags, newItem, rollMod, spawnWeight, type Item } from '../engine/item.ts'
import { int, pickWeighted, type Rng } from '../engine/rng.ts'
import { baseKindKeys, tierOf } from './describe.ts'
import { BUILDS, popularity, type Meta, type Slot } from './meta.ts'
import { basePrice, buyableBases, currencyPrice } from './shop.ts'
import { quote, slotOf } from './value.ts'

export interface Want { stat: string; maxTier: number }
export interface Commission {
  id: number
  build: string
  slot: Slot
  classes: string[] // item classes that count
  defence?: string[] // one of these defences, if the build cares
  wants: Want[]
  until: number // last day to deliver
  reward: number
}

export const BOARD_MAX = 5
export const COMMISSION_DAYS = 3 // today and the next two
export const COMMISSION_BONUS = 1.5
export const REWARD_FIRST = 0.6 // day 1
export const REWARD_LAST = 1.5 // last day; straight line between
export const rewardScale = (day: number, lastDay: number) => REWARD_FIRST + (REWARD_LAST - REWARD_FIRST) * (day - 1) / (lastDay - 1)
const HITS = 20
const MAX_ROLLS = 1500 // rarer orders hit the Laplace cap: they are hard anyway, and day close stays quick
const WANTS = 2
const MAX_TIER: Record<string, number> = { starter: 3, advanced: 2, uber: 1 }
const ILVL = 84

const classesOf = (slot: Slot) => [...new Set(buyableBases().map((b) => BASES[b].cls))].filter((c) => slotOf(c) === slot)
const hasStat = (id: string, stat: string) => MODS[id].stats.some(([s]) => s === stat)

export function canDeliver(item: Item, c: Commission): boolean {
  if (!c.classes.includes(BASES[item.base].cls)) return false
  if (c.defence && !c.defence.some((d) => baseKindKeys(item.base).defences.includes(d))) return false
  return c.wants.every((w) => item.explicits.some((m) => hasStat(m.id, w.stat) && tierOf(item, m.id) <= w.maxTier))
}

function makeCommission(id: number, day: number, lastDay: number, meta: Meta, rng: Rng): Commission | undefined {
  const b = pickWeighted(rng, BUILDS, (x) => popularity(meta, x.id))!
  const slots = Object.keys(b.slots) as Slot[]
  const slot = slots[int(rng, 0, slots.length - 1)]
  const want = b.slots[slot]!
  const classes = want.classes ?? classesOf(slot)
  const bases = buyableBases().filter((x) => classes.includes(BASES[x].cls)
    && (!want.defence || want.defence.some((d) => baseKindKeys(x).defences.includes(d))))
  if (!bases.length) return undefined
  const ref = newItem(bases[int(rng, 0, bases.length - 1)], ILVL, rng)
  const tags = itemTags(ref)
  const maxTier = MAX_TIER[b.tier]
  // Options the build really wants, in random order; for each, the worst mod that still meets the tier, rolling here.
  const stats = Object.entries(want.wants).filter(([, w]) => w >= 0.7).map(([s]) => s)
  for (let k = stats.length - 1; k > 0; k--) {
    const j = int(rng, 0, k)
    ;[stats[k], stats[j]] = [stats[j], stats[k]]
  }
  const picked: string[] = []
  const wants: Want[] = []
  for (const stat of stats) {
    if (wants.length === WANTS) break
    const fits = Object.keys(MODS).filter((id) => {
      const m = MODS[id]
      return (m.gen === 'prefix' || m.gen === 'suffix') && !m.dom && !m.essenceOnly && !m.elev && hasStat(id, stat)
        && m.lvl <= ILVL && spawnWeight(id, tags) > 0 && tierOf(ref, id) <= maxTier
        && !picked.some((p) => MODS[p].grp.some((g) => m.grp.includes(g)))
    })
    if (!fits.length) continue
    const worst = fits.reduce((a, x) => (tierOf(ref, x) > tierOf(ref, a) ? x : a))
    picked.push(worst)
    wants.push({ stat, maxTier })
  }
  if (wants.length < WANTS) return undefined
  const plainest: Item = { ...ref, rarity: 'rare', explicits: picked.map((m) => rollMod(m, rng)) }
  const c: Commission = { id, build: b.id, slot, classes, ...(want.defence && { defence: want.defence }), wants, until: Math.min(lastDay, day + COMMISSION_DAYS - 1), reward: 0 }
  const sides = new Set(picked.map((m) => MODS[m].gen))
  const bySpam = basePrice(ref.base, ILVL, day) + spamCost(ref, c, sides.size === 2)
  const reward = Math.max(COMMISSION_BONUS * quote(plainest, 'en', day, meta).price, bySpam) * rewardScale(day, lastDay)
  return { ...c, reward: Math.round(reward) }
}

// Expected spend to fill the order from a plain base by the cheapest plain spam (fixed seed: same order, same reward).
// Alchemy + scouring rolls a rare just like a chaos orb, so one measurement serves both (Laplace-capped, so a hopeless
// order still gets a price). Alteration spam only when it can hit (one prefix + one suffix wanted).
function spamCost(base: Item, c: Commission, altable: boolean): number {
  const odds = (start: Item, roll: (i: Item, r: Rng) => Item, laplace: boolean) => {
    const rng = { s: c.id }
    let hits = 0
    let tries = 0
    while (hits < HITS && tries < MAX_ROLLS) {
      if (canDeliver(roll(start, rng), c)) hits++
      tries++
    }
    return hits >= HITS ? hits / tries : laplace ? (hits + 1) / (tries + 2) : hits / tries
  }
  const altAug = (i: Item, r: Rng) => {
    const a = CURRENCIES.alteration.apply(i, r)
    return CURRENCIES.augmentation.can(a) ? CURRENCIES.augmentation.apply(a, r) : a
  }
  const per = (c: Parameters<typeof currencyPrice>[0]) => currencyPrice(c)
  const rare = Math.min(per('chaos'), per('alchemy') + per('scouring')) / odds({ ...base, rarity: 'rare' }, CURRENCIES.chaos.apply, true)
  return altable ? Math.min(rare, (per('alteration') + per('augmentation')) / odds({ ...base, rarity: 'magic' }, altAug, false)) : rare
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
