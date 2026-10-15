// Influence crafting: Shaper's/Elder's/Conqueror Exalted Orbs, Awakener's Orb, Orb of Dominance.
// Rules follow each orb's PoE Wiki page (PLAN §3.3).
import { fill, rareModCount } from './currency.ts'
import { BASES, CLASS_INFLUENCE_TAGS, MODS, type Influence } from './data.ts'
import { addRandomMod, affixLimits, changeable, editable, fractured, isPrefix, itemTags, modPool, rollMod, spawnWeight, type Item, type RolledMod } from './item.ts'
import { int, type Rng } from './rng.ts'

// Also the order influences are listed on an item (Awakener's Orb result).
export const INFLUENCES: Influence[] = ['shaper', 'elder', 'crusader', 'redeemer', 'hunter', 'warlord']
const BY_TAG: Record<string, Influence> = {
  shaper: 'shaper', elder: 'elder', crusader: 'crusader', eyrie: 'redeemer', basilisk: 'hunter', adjudicator: 'warlord',
}
const INFLUENCE_TAG = /_(shaper|elder|crusader|eyrie|basilisk|adjudicator)$/

// The influence a mod belongs to ("Shaper's", "of the Crusade", elevated mods...), or undefined for ordinary mods.
export function modInfluence(id: string): Influence | undefined {
  const m = MODS[id]
  if (!m || m.dom || (m.gen !== 'prefix' && m.gen !== 'suffix')) return undefined
  // Elevated mods never roll (weight 0), so their tags tell where they belong.
  const tags = (m.elev ? m.spawn : m.spawn.filter(([, w]) => w > 0)).map(([t]) => t).filter((t) => t !== 'default')
  if (!tags.length || !tags.every((t) => INFLUENCE_TAG.test(t))) return undefined
  return BY_TAG[tags[0].split('_').pop()!]
}
export const isInfluenced = (id: string) => modInfluence(id) !== undefined

const eldritch = (i: Item) => i.implicits.some((m) => /exarch|eater/.test(MODS[m.id]?.gen ?? ''))
const pick = <T>(rng: Rng, xs: T[]) => xs[int(rng, 0, xs.length - 1)]

// ---- Shaper's / Elder's / Conqueror Exalted Orbs: a rare with no influence gains the influence and one of its mods.
// Not on fractured, synthesised (not in this game) or eldritch-implicit items; needs an open side where a mod of that
// influence can roll at this item level; honours "Cannot roll Attack/Caster Modifiers" (3.9.2c).
export const AWAKENER = "Awakener's Orb"
export const DOMINANCE = 'Orb of Dominance'
export const INFLUENCE_EXALTS: Record<string, Influence> = {
  "Shaper's Exalted Orb": 'shaper', "Elder's Exalted Orb": 'elder', "Crusader's Exalted Orb": 'crusader',
  "Redeemer's Exalted Orb": 'redeemer', "Hunter's Exalted Orb": 'hunter', "Warlord's Exalted Orb": 'warlord',
}
export const influenceOnly = (item: Item, inf: Influence) => {
  const tag = new Set([CLASS_INFLUENCE_TAGS[BASES[item.base].cls][inf]])
  return (id: string) => (spawnWeight(id, tag) > 0 ? 1 : 0)
}
export function canInfluenceExalt(item: Item, inf: Influence): boolean {
  if (!editable(item) || item.rarity !== 'rare' || item.influences.length || fractured(item) || eldritch(item)) return false
  const only = influenceOnly(item, inf)
  return modPool({ ...item, influences: [inf] }).some((id) => only(id) > 0)
}
export const applyInfluenceExalt = (item: Item, inf: Influence, rng: Rng): Item =>
  addRandomMod({ ...item, influences: [inf] }, rng, { weight: influenceOnly(item, inf) }) ?? item

// ---- Awakener's Orb: destroys the donor, the target becomes a rare with both influences.
// Same item class, exactly one influence each and different, neither corrupted nor fractured. The target keeps base, item level,
// quality and implicits. One random influence mod from each survives (if both share a mod group, one is dropped at
// random), keeping its tier with a fresh roll; everything else is rerolled, ignoring meta-crafts.
export function canAwaken(donor: Item, target: Item): boolean {
  return donor !== target && editable(donor) && editable(target) && !fractured(donor) && !fractured(target)
    && BASES[donor.base].cls === BASES[target.base].cls
    && donor.influences.length === 1 && target.influences.length === 1 && donor.influences[0] !== target.influences[0]
}
export function applyAwaken(donor: Item, target: Item, rng: Rng): Item {
  const influenceMod = (i: Item) => {
    const xs = i.explicits.filter((m) => isInfluenced(m.id))
    return xs.length ? pick(rng, xs) : undefined
  }
  let kept = [influenceMod(target), influenceMod(donor)].filter((m): m is RolledMod => !!m)
  if (kept.length === 2 && MODS[kept[0].id].grp.some((g) => MODS[kept[1].id].grp.includes(g))) kept = [pick(rng, kept)]
  const influences = INFLUENCES.filter((x) => x === donor.influences[0] || x === target.influences[0])
  const result: Item = { ...target, rarity: 'rare', influences, explicits: [] }
  // ponytail: two kept prefixes on a 1-prefix base (Simplex Amulet) keep only what fits; real behaviour unknown.
  const limits = affixLimits(result)
  for (const m of kept) {
    const side = result.explicits.filter((x) => isPrefix(x) === isPrefix(m)).length
    if (side < (isPrefix(m) ? limits.prefix : limits.suffix)) result.explicits.push(rollMod(m.id, rng))
  }
  // ponytail: total mod count rolls like a Chaos Orb (4/5/6), counting the kept mods; the wiki doesn't give numbers.
  return fill(result, rareModCount(rng) - result.explicits.length, rng)
}

// ---- Orb of Dominance: magic/rare body armour, helmet, gloves or boots with 2+ influence mods. One random influence mod
// goes up a tier (tier 1 -> its elevated version, elevated -> new values), another random influence mod is removed.
// Mods that can't change (fractured, meta-craft locked side) are left alone.
const DOMINANCE_CLASSES = ['Body Armour', 'Helmet', 'Gloves', 'Boots']
const dominable = (i: Item) => i.explicits.filter((m) => isInfluenced(m.id) && changeable(i, m))
export const canDominance = (i: Item) => editable(i) && (i.rarity === 'magic' || i.rarity === 'rare')
  && DOMINANCE_CLASSES.includes(BASES[i.base].cls) && dominable(i).length >= 2

// Next tier of the same influence mod family on this item (no item level requirement), else the elevated version.
// Same influence throughout: Shaper's and Hunter's versions of a family are separate ladders even on a dual item.
export function upgradeOf(item: Item, id: string): string {
  const m = MODS[id]
  if (m.elev) return id
  const inf = modInfluence(id)
  const tags = itemTags({ ...item, explicits: [] })
  const higher = Object.keys(MODS).filter((o) => MODS[o].type === m.type && MODS[o].gen === m.gen && !MODS[o].elev
    && MODS[o].lvl > m.lvl && modInfluence(o) === inf && spawnWeight(o, tags) > 0)
  if (higher.length) return higher.reduce((a, b) => (MODS[a].lvl <= MODS[b].lvl ? a : b))
  return Object.keys(MODS).find((o) => MODS[o].elev === m.type && MODS[o].gen === m.gen && modInfluence(o) === inf
    && MODS[o].spawn.some(([t]) => t !== 'default' && tags.has(t))) ?? id
}
export function applyDominance(item: Item, rng: Rng): Item {
  const xs = dominable(item)
  const up = pick(rng, xs)
  const gone = pick(rng, xs.filter((m) => m !== up))
  return {
    ...item,
    explicits: item.explicits.filter((m) => m !== gone).map((m) => (m === up ? rollMod(upgradeOf(item, m.id), rng) : m)),
  }
}
