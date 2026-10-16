// Commission board (D38): builds post orders for one slot — the base they like best and a few options they want at a
// tier or better, a deadline and a fixed reward. Delivering uses one of the day's sales and pays at the next day close,
// like a sale. Orders ask for 3 options at first and 4 from mid-run on (user).
// Reward (user, 2026-10-16): COMMISSION_BONUS x (the base's shop price + the option value Faustus gives the plainest item
// that fills the order), on the day it's posted. The plainest item: the order's base, each option at the worst tier that
// still counts, rolled exactly at the numbers asked. Was the option value alone, which left out the base: a three-
// resistance glove order paid 174 gold for an item Faustus buys for 3,600 (its base), so delivering lost to selling.
// Base + options is never below Faustus's price, so an order always pays more than selling the same item.
// Option asks are numbers, not tiers (user): a tier-1 ask wants the lowest tier-1 roll, a "tier 1-3" ask a value inside
// tier 3's range (30-90% up it, per order), so a good tier 3 passes, a poor one doesn't, tier 2 always does. Paired stats
// (added damage "a to b") ask both. Judged on the item's explicit options added up.
// Defence orders (user): an armour order where the build wants defence options asks, for each defence of the base, a
// total instead of options for it, and takes any base of that class and defence. The bar is the top ordinary base of that
// kind with a flat and an increased local option of that defence at DEFENCE_TIER (starter 4, advanced 3, uber 2; lowest
// roll, no quality): the top base gets there with those tiers, lower bases need better ones, or quality.
// A build that doesn't look at defence there (life first, say) still wants a decent base: each defence at least what the
// second-best ordinary base of the kind has bare, on top of the options asked; any base of the kind will do.
// Attack weapon orders (user: judged by DPS as armour is by defence): an attack build's weapon order asks a DPS (physical,
// elemental or total, by which damage options the build wants) instead of those options, and takes any base of the class.
// The bar: the class's top base by physical DPS with the build's damage options at DEFENCE_TIER (lowest roll), in tens.
import { BASES, MODS } from '../engine/data.ts'
import {
  affixLimits, baseDefence, baseDps, defenceFlat, defenceInc, defences, DPS_STATS, isDefenceStat, itemTags, newItem, spawnWeight, weaponStats,
  type Defence, type DpsKind, type Item, type RolledMod,
} from '../engine/item.ts'
import { int, next, pickWeighted, type Rng } from '../engine/rng.ts'
import { baseKindKeys, tierOf } from './describe.ts'
import { BUILDS, popularity, type Meta, type Slot } from './meta.ts'
import { baseGroup, basePrice, buyableBases, isSpecialBase } from './shop.ts'
import { baseAppeal, quote, slotOf } from './value.ts'

// min/stat2/min2: the numbers asked (older saves: the tier only). maxTier stays for the reference item.
export type Want = { stat: string; maxTier: number; min?: number; stat2?: string; min2?: number } | { defence: Defence; min: number }
  | { dps: DpsKind; min: number }
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
// The first days post no order worth tens of millions (user): nobody has that kind of gold yet. Such an order is
// dropped and the board draws another.
export const EARLY_DAYS = 3
export const EARLY_REWARD_MAX = 10_000_000
const BASE_TIE = 0.95 // bases within 5% of the build's favourite are just as good: one is picked at random
const MAX_TIER: Record<string, number> = { starter: 3, advanced: 2, uber: 1 }
export const DEFENCE_TIER: Record<string, number> = { starter: 4, advanced: 3, uber: 2 }
const ARMOUR = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield']
const ILVL = 84

const classesOf = (slot: Slot) => [...new Set(buyableBases().map((b) => BASES[b].cls))].filter((c) => slotOf(c) === slot)
const hasStat = (id: string, stat: string) => MODS[id].stats.some(([s]) => s === stat)
const total = (item: Item, stat: string) =>
  item.explicits.reduce((s, m) => s + MODS[m.id].stats.reduce((t, [sid], i) => t + (sid === stat ? m.values[i] : 0), 0), 0)
// A negative ask ("-7 to Total Mana Cost") is met by going lower.
const reaches = (v: number, ask: number) => (ask < 0 ? v <= ask : v >= ask)
export const meetsWant = (item: Item, w: Want) => {
  if ('defence' in w) return (defences(item)[w.defence] ?? 0) >= w.min
  if ('dps' in w) return (weaponStats(item)?.dps[w.dps] ?? 0) >= w.min
  if (w.min === undefined) return item.explicits.some((m) => hasStat(m.id, w.stat) && tierOf(item, m.id) <= w.maxTier)
  return reaches(total(item, w.stat), w.min) && (!w.stat2 || reaches(total(item, w.stat2), w.min2!))
}
// Paired stats of one line: the minimum and maximum of added damage.
const partner = (stat: string) => (/minimum/.test(stat) ? stat.replace('minimum', 'maximum') : /maximum/.test(stat) ? stat.replace('maximum', 'minimum') : undefined)
// The number to ask of one stat of this mod: its lowest roll for tier 1, else `at` of the way up its range (towards
// "better", which is lower for negative stats).
function ask(id: string, stat: string, at: number): number {
  const [, a, b] = MODS[id].stats.find(([s]) => s === stat)!
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return Math.round(hi <= 0 ? hi - at * (hi - lo) : lo + at * (hi - lo))
}
export const DEFENCE_STEP = 10 // defence asks in tens (user): rounded down, so they stay reachable

// The defence bars for this kind of base (see the top): the top ordinary base of the kind (best over its defences), with
// a flat and an increased option of each defence at that tier (lowest roll, room and groups permitting); the totals it
// then shows are the bars, so they can always be met.
export function defenceBars(base: string, defs: Defence[], tier: number): { top: string; mins: Partial<Record<Defence, number>>; mods: string[] } {
  const kin = buyableBases().filter((b) => baseGroup(b) === baseGroup(base) && !isSpecialBase(b))
  const best = (d: Defence) => Math.max(1, ...kin.map((b) => baseDefence(b, d)))
  const score = (b: string) => defs.reduce((s, d) => s + baseDefence(b, d) / best(d), 0)
  const top = kin.reduce((x, y) => (score(y) > score(x) ? y : x), base)
  const ref: Item = { ...newItem(top, ILVL, { s: 1 }), rarity: 'rare' }
  const mods = barMods(ref, defs.flatMap((d) => [[defenceFlat(d)], defenceInc(d)]), tier)
  const total = defences({ ...ref, explicits: mods.map(lowest) })
  return { top, mods, mins: Object.fromEntries(defs.map((d) => [d, Math.floor((total[d] ?? 0) / DEFENCE_STEP) * DEFENCE_STEP])) }
}

const lowest = (id: string): RolledMod => ({ id, values: MODS[id].stats.map(([, x, y]) => Math.min(x, y)) })
// For each stat list, the best option of exactly that tier carrying one of the stats (or the worst tier there is, if the
// ladder is short), as long as its group is free and its side has room.
function barMods(ref: Item, wanted: string[][], tier: number): string[] {
  const tags = itemTags(ref)
  const room = affixLimits(ref)
  const low = (id: string, stats: string[]) => Math.min(...MODS[id].stats.filter(([s]) => stats.includes(s)).map(([, x, y]) => Math.min(x, y)))
  const at = (stats: string[]) => {
    const all = Object.keys(MODS).filter((id) => {
      const m = MODS[id]
      return (m.gen === 'prefix' || m.gen === 'suffix') && !m.dom && !m.essenceOnly && !m.elev && !m.drop && m.lvl <= ILVL
        && spawnWeight(id, tags) > 0 && m.stats.some(([s]) => stats.includes(s))
    })
    if (!all.length) return undefined
    const worst = Math.max(...all.map((id) => tierOf(ref, id)))
    return all.filter((id) => tierOf(ref, id) === Math.min(tier, worst)).reduce((x, id) => (low(id, stats) > low(x, stats) ? id : x))
  }
  const mods: string[] = []
  for (const id of wanted.map(at)) {
    if (!id || mods.some((p) => MODS[p].grp.some((g) => MODS[id].grp.includes(g)))) continue
    if (mods.filter((p) => MODS[p].gen === MODS[id].gen).length >= (MODS[id].gen === 'prefix' ? room.prefix : room.suffix)) continue
    mods.push(id)
  }
  return mods
}

// An attack build's weapon (it wants attack speed, physical damage or critical strike chance there): which DPS it asks.
const ATTACK_SIGNS = ['local_attack_speed_+%', 'local_physical_damage_+%', 'local_minimum_added_physical_damage', 'local_critical_strike_chance_+%']
export function dpsKind(wants: Record<string, number>): DpsKind | undefined {
  if (!ATTACK_SIGNS.some((s) => (wants[s] ?? 0) >= 0.7)) return undefined
  const has = (re: RegExp) => Object.entries(wants).some(([s, w]) => w >= 0.7 && re.test(s))
  const phys = has(/^local_(physical_damage_+%|(minimum|maximum)_added_physical_damage)$/)
  const ele = has(/^local_(minimum|maximum)_added_(fire|cold|lightning)_damage$/)
  return phys && !ele ? 'phys' : ele && !phys ? 'ele' : 'total'
}
export function dpsBar(base: string, kind: DpsKind, stats: string[], tier: number): { top: string; mods: string[]; min: number } {
  const kin = buyableBases().filter((b) => BASES[b].cls === BASES[base].cls && !isSpecialBase(b))
  const top = kin.reduce((x, y) => (baseDps(y) > baseDps(x) ? y : x), base)
  const ref: Item = { ...newItem(top, ILVL, { s: 1 }), rarity: 'rare' }
  const mods = barMods(ref, stats.map((s) => [s]), tier)
  const dps = weaponStats({ ...ref, explicits: mods.map(lowest) })?.dps[kind] ?? 0
  return { top, mods, min: Math.floor(dps / DEFENCE_STEP) * DEFENCE_STEP }
}

// Each defence at least what the second-best ordinary base of this kind has bare (the top two in the shop pass as they
// are, lower ones need a defence option or quality).
export function decentBase(base: string, defs: Defence[]): Want[] {
  const kin = buyableBases().filter((b) => baseGroup(b) === baseGroup(base) && !isSpecialBase(b))
  const best = (d: Defence) => Math.max(1, ...kin.map((b) => baseDefence(b, d)))
  const score = (b: string) => defs.reduce((s, d) => s + baseDefence(b, d) / best(d), 0)
  const ranked = [...kin].sort((x, y) => score(y) - score(x))
  const second = ranked[Math.min(1, ranked.length - 1)] ?? base
  return defs.map((d) => ({ defence: d, min: Math.floor(baseDefence(second, d) / DEFENCE_STEP) * DEFENCE_STEP }))
}

// The order's base (or class and defence) part.
export const baseFits = (item: Item, c: Commission) => (c.base ? item.base === c.base : c.classes.includes(BASES[item.base].cls))
  && (!c.defence || c.defence.some((d) => baseKindKeys(item.base).defences.includes(d)))
export const canDeliver = (item: Item, c: Commission) => baseFits(item, c) && c.wants.every((w) => meetsWant(item, w))

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
  // One or two defences; a three-defence base (Sacrificial Garb, Grasping Mail) is a special case.
  const kinds = baseKindKeys(base).defences.filter((d): d is Defence => d !== 'ward')
  const armour = ARMOUR.includes(BASES[base].cls) && !isSpecialBase(base) && kinds.length >= 1 && kinds.length <= 2
  const caring = armour && Object.entries(want.wants).some(([s, w]) => w >= 0.7 && isDefenceStat(s))
  const defs = caring ? kinds : []
  const bars = defs.length ? defenceBars(base, defs, DEFENCE_TIER[b.tier]) : undefined
  const kind = slot === 'weapon' ? dpsKind(want.wants) : undefined
  const bar = kind ? dpsBar(base, kind, DPS_STATS.filter((s) => (want.wants[s] ?? 0) >= 0.7), DEFENCE_TIER[b.tier]) : undefined
  const dps = bar && bar.min > 0 ? { kind: kind!, ...bar } : undefined
  const tags = itemTags(ref)
  const maxTier = MAX_TIER[b.tier]
  const count = wantsOn(day)
  const room = affixLimits({ ...ref, rarity: 'rare' })
  // Options the build really wants, in random order; for each, the worst mod that still meets the tier, rolling here,
  // as long as its side has room.
  const stats = Object.entries(want.wants).filter(([s, w]) => w >= 0.7 && !(defs.length && isDefenceStat(s)) && !(dps && DPS_STATS.includes(s)))
    .map(([s]) => s)
  for (let k = stats.length - 1; k > 0; k--) {
    const j = int(rng, 0, k)
    ;[stats[k], stats[j]] = [stats[j], stats[k]]
  }
  // The defence options sit on the reference item too (they take room and count in its value).
  const picked: string[] = [...(bars?.mods ?? []), ...(dps?.mods ?? [])].filter((id) => spawnWeight(id, tags) > 0)
  // The reference item's options: defence ones at their lowest roll (that's how the bars are set), asked ones at the asks.
  const rolled: RolledMod[] = picked.map((id) => ({ id, values: MODS[id].stats.map(([, x, y]) => Math.min(x, y)) }))
  const wants: Want[] = [...defs.map((d) => ({ defence: d, min: bars!.mins[d] ?? 0 })), ...(dps ? [{ dps: dps.kind, min: dps.min }] : [])]
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
    // The stat's main family (the one giving the most of it, not a hybrid carrying a little), its worst accepted tier.
    const most = (id: string) => Math.max(...MODS[id].stats.filter(([s]) => s === stat).map(([, a, b]) => Math.max(Math.abs(a), Math.abs(b))))
    const main = MODS[fits.reduce((a, x) => (most(x) > most(a) ? x : a))].type
    const worst = fits.filter((x) => MODS[x].type === main).reduce((a, x) => (tierOf(ref, x) > tierOf(ref, a) ? x : a))
    picked.push(worst)
    const at = maxTier === 1 ? 0 : 0.3 + 0.6 * next(rng)
    rolled.push({ id: worst, values: MODS[worst].stats.map(([s]) => ask(worst, s, at)) })
    const pair = partner(stat)
    const two = pair && hasStat(worst, pair) ? pair : undefined
    // Ask the pair as minimum then maximum, so the line reads "a to b".
    const [s1, s2] = two && /maximum/.test(stat) ? [two, stat] : [stat, two]
    wants.push({ stat: s1, maxTier, min: ask(worst, s1, at), ...(s2 && { stat2: s2, min2: ask(worst, s2, at) }) })
  }
  if (wants.length < (dps ? 1 : count)) return undefined // a DPS ask stands in for the damage options it replaced
  if (armour && !caring) wants.push(...decentBase(base, kinds))
  const plainest: Item = { ...ref, rarity: 'rare', explicits: rolled }
  const c: Commission = {
    id, build: b.id, slot, wants,
    ...(armour ? { classes: [BASES[base].cls], defence: kinds }
      : dps ? { classes: [BASES[base].cls] } : { classes, ...(want.defence && { defence: want.defence }), base }),
    until: Math.min(lastDay, day + COMMISSION_DAYS - 1), reward: 0,
  }
  const reward = Math.round(COMMISSION_BONUS * (basePrice(base, ILVL, day) + quote(plainest, 'en', day, meta).optionValue))
  return day <= EARLY_DAYS && reward >= EARLY_REWARD_MAX ? undefined : { ...c, reward }
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
