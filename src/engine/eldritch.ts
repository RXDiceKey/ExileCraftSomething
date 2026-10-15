// Eldritch crafting: Embers add Searing Exarch implicits, Ichors add Eater of Worlds implicits (body armour, helmets,
// gloves, boots). The higher-tier one "dominates" and picks the side the Eldritch Chaos/Exalted/Annulment work on;
// Orbs of Conflict trade tiers between the two. Rules: PoE Wiki pages of each item (PLAN §3.3).
import { rareModCount } from './currency.ts'
import { BASES, MODS } from './data.ts'
import { addRandomMod, affixCounts, affixLimits, changeable, editable, isPrefix, itemTags, rollMod, spawnWeight, type Item, type RolledMod, type RollOptions } from './item.ts'
import { int, next, pickWeighted, type Rng } from './rng.ts'

export type Eldritch = 'exarch' | 'eater'
const GEN: Record<Eldritch, string> = { exarch: 'searing_exarch_implicit', eater: 'eater_of_worlds_implicit' }
export const ELDRITCH_CLASSES = ['Body Armour', 'Helmet', 'Gloves', 'Boots']
export const EMBERS: Record<string, number> = {
  'Lesser Eldritch Ember': 1, 'Greater Eldritch Ember': 2, 'Grand Eldritch Ember': 3, 'Exceptional Eldritch Ember': 4,
}
export const ICHORS: Record<string, number> = {
  'Lesser Eldritch Ichor': 1, 'Greater Eldritch Ichor': 2, 'Grand Eldritch Ichor': 3, 'Exceptional Eldritch Ichor': 4,
}
export const ELDRITCH_CHAOS = 'Eldritch Chaos Orb'
export const ELDRITCH_EXALT = 'Eldritch Exalted Orb'
export const ELDRITCH_ANNUL = 'Eldritch Orb of Annulment'
export const CONFLICT = 'Orb of Conflict'

export const eldritchSide = (m: RolledMod): Eldritch | undefined =>
  MODS[m.id]?.gen === GEN.exarch ? 'exarch' : MODS[m.id]?.gen === GEN.eater ? 'eater' : undefined
// 0 when the item has no implicit of that side.
export const eldritchTier = (item: Item, side: Eldritch) => MODS[item.implicits.find((m) => eldritchSide(m) === side)?.id ?? '']?.et ?? 0
// Higher tier wins; equal tiers (or none) dominate nothing.
export function dominance(item: Item): Eldritch | undefined {
  const x = eldritchTier(item, 'exarch')
  const y = eldritchTier(item, 'eater')
  return x > y ? 'exarch' : y > x ? 'eater' : undefined
}


// ---- Embers / Ichors: normal, magic or rare armour piece without Shaper/Elder/Conqueror influence.
// The new implicit replaces every implicit except the other eldritch side's. Eldritch implicits need item level 75.
function implicitPool(item: Item, side: Eldritch, tier: number): string[] {
  const tags = itemTags({ ...item, explicits: [] })
  return Object.keys(MODS).filter((id) => MODS[id].gen === GEN[side] && MODS[id].et === tier && MODS[id].lvl <= item.ilvl
    && spawnWeight(id, tags) > 0)
}
export const canEldritchImplicit = (item: Item, side: Eldritch, tier: number) => editable(item)
  && ELDRITCH_CLASSES.includes(BASES[item.base].cls) && !item.influences.length && implicitPool(item, side, tier).length > 0
export function applyEldritchImplicit(item: Item, side: Eldritch, tier: number, rng: Rng): Item {
  const tags = itemTags({ ...item, explicits: [] })
  const id = pickWeighted(rng, implicitPool(item, side, tier), (x) => spawnWeight(x, tags))!
  const other = item.implicits.filter((m) => { const s = eldritchSide(m); return s && s !== side })
  const implicits = [...other, rollMod(id, rng)].sort((a, b) => (eldritchSide(a) === 'exarch' ? -1 : eldritchSide(b) === 'exarch' ? 1 : 0))
  return { ...item, implicits }
}

// Mods only on the dominant side: Searing Exarch -> prefixes, Eater of Worlds -> suffixes.
const onSide = (side: Eldritch) => (m: RolledMod) => isPrefix(m) === (side === 'exarch')
const sideOnly = (side: Eldritch): RollOptions => ({ weight: (id) => ((MODS[id].gen === 'prefix') === (side === 'exarch') ? 1 : 0) })

// ---- Eldritch Chaos Orb: rare with a dominant side; rerolls that side. Ignores "Prefixes/Suffixes Cannot Be Changed"
// (Metamod table) but honours "Cannot roll Attack/Caster Modifiers". Fractured mods stay.
// ponytail: how many new mods (not preserved since 3.17.2) isn't published; the item's total rolls like a Chaos Orb
// (4/5/6), at least one new mod, new mods only on the dominant side.
export const canEldritchChaos = (i: Item) => editable(i) && i.rarity === 'rare' && !!dominance(i)
export function applyEldritchChaos(item: Item, rng: Rng): Item {
  const side = dominance(item)!
  let out: Item = { ...item, explicits: item.explicits.filter((m) => !onSide(side)(m) || m.fractured) }
  const total = Math.max(out.explicits.length + 1, rareModCount(rng))
  while (out.explicits.length < total) {
    const added = addRandomMod(out, rng, sideOnly(side))
    if (!added) break
    out = added
  }
  return out
}

// ---- Eldritch Exalted Orb: rare with a dominant side and room there; adds a mod on that side.
export function canEldritchExalt(i: Item): boolean {
  const side = dominance(i)
  if (!editable(i) || i.rarity !== 'rare' || !side) return false
  const c = affixCounts(i)
  const l = affixLimits(i)
  return side === 'exarch' ? c.prefix < l.prefix : c.suffix < l.suffix
}
export const applyEldritchExalt = (i: Item, rng: Rng) => addRandomMod(i, rng, sideOnly(dominance(i)!)) ?? i

// ---- Eldritch Orb of Annulment: magic or rare with a dominant side; removes one mod from that side (locks respected).
const annullable = (i: Item) => { const side = dominance(i); return side ? i.explicits.filter((m) => onSide(side)(m) && changeable(i, m)) : [] }
export const canEldritchAnnul = (i: Item) => editable(i) && (i.rarity === 'magic' || i.rarity === 'rare') && annullable(i).length > 0
export function applyEldritchAnnul(i: Item, rng: Rng): Item {
  const xs = annullable(i)
  const gone = xs[int(rng, 0, xs.length - 1)]
  return { ...i, explicits: i.explicits.filter((m) => m !== gone) }
}

// ---- Orb of Conflict: both implicits needed. One goes up a tier, the other down (a Lesser one is removed).
// Chance to raise a given side: 50% at equal tiers, about 11% less per tier it's ahead (wiki: 5/3 -> 28% for the 5).
// Perfect (6) can't go higher.
export const MAX_ELDRITCH_TIER = 6
export const canConflict = (i: Item) => {
  const x = eldritchTier(i, 'exarch')
  const y = eldritchTier(i, 'eater')
  return editable(i) && x > 0 && y > 0 && (x < MAX_ELDRITCH_TIER || y < MAX_ELDRITCH_TIER)
}
export function conflictChance(item: Item): number {
  const x = eldritchTier(item, 'exarch')
  const y = eldritchTier(item, 'eater')
  if (x >= MAX_ELDRITCH_TIER) return 0
  if (y >= MAX_ELDRITCH_TIER) return 1
  return Math.min(1, Math.max(0, 0.5 - 0.11 * (x - y)))
}
// Same eldritch family, one tier up or down; undefined when there is none (a Lesser implicit lowered is removed).
function shift(id: string, d: number): string | undefined {
  const m = MODS[id]
  return Object.keys(MODS).find((o) => MODS[o].gen === m.gen && MODS[o].type === m.type && MODS[o].et === m.et! + d)
}
export function applyConflict(item: Item, rng: Rng): Item {
  const up: Eldritch = next(rng) < conflictChance(item) ? 'exarch' : 'eater'
  const implicits = item.implicits.flatMap((m) => {
    const side = eldritchSide(m)
    if (!side) return [m]
    const id = shift(m.id, side === up ? 1 : -1)
    return id ? [rollMod(id, rng)] : side === up ? [m] : []
  })
  return { ...item, implicits }
}
