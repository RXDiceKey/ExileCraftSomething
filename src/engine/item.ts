import { BASES, CLASS_INFLUENCE_TAGS, MODS, type Influence } from './data.ts'
import { int, pickWeighted, type Rng } from './rng.ts'

export type Rarity = 'normal' | 'magic' | 'rare'

// Only mod ids and rolled numbers are stored, so saves don't depend on the display language.
export interface RolledMod {
  id: string
  values: number[] // one per stat, in MODS[id].stats order
  crafted?: true // bench craft
  fractured?: true // locked by a Fracturing Orb
  unveil?: string[] // veiled placeholder: the unveiled mods offered, once the player has looked
}

export interface Item {
  base: string
  ilvl: number
  rarity: Rarity
  implicits: RolledMod[]
  explicits: RolledMod[]
  influences: Influence[]
  quality?: number
  corrupted?: true
  mirrored?: true
  imprint?: Item // Craicic Croaker snapshot of this item while it was magic
}

// "Lucky" (Sanctified Fossil): roll twice, keep the better one.
export function rollMod(id: string, rng: Rng, lucky = false): RolledMod {
  const roll = (a: number, b: number) => int(rng, Math.min(a, b), Math.max(a, b))
  return {
    id,
    values: MODS[id].stats.map(([, a, b]) => (lucky ? Math.max(roll(a, b), roll(a, b)) : roll(a, b))),
  }
}

export function newItem(base: string, ilvl: number, rng: Rng, influences: Influence[] = []): Item {
  return { base, ilvl, rarity: 'normal', implicits: BASES[base].imp.map((id) => rollMod(id, rng)), explicits: [], influences }
}

export const isPrefix = (m: RolledMod) => MODS[m.id].gen === 'prefix'

// Can currency touch this item? Not corrupted or mirrored, and no veiled mod waiting to be unveiled (game message:
// "Cannot modify Veiled Items").
export const editable = (i: Item) => !i.corrupted && !i.mirrored && !i.explicits.some((m) => MODS[m.id].dom === 'veiled')

export function affixCounts(item: Item) {
  const prefix = item.explicits.filter(isPrefix).length
  return { prefix, suffix: item.explicits.length - prefix }
}

// Some bases change the limits through their implicit (e.g. Simplex Amulet: 1 prefix / 2 suffixes).
export function affixLimits(item: Item) {
  if (item.rarity === 'normal') return { prefix: 0, suffix: 0 }
  if (item.rarity === 'magic') return { prefix: 1, suffix: 1 }
  let prefix = 3
  let suffix = 3
  for (const m of item.implicits) {
    MODS[m.id].stats.forEach(([sid], i) => {
      if (sid === 'local_maximum_prefixes_allowed_+') prefix += m.values[i]
      if (sid === 'local_maximum_suffixes_allowed_+') suffix += m.values[i]
    })
  }
  return { prefix, suffix }
}

export function hasOpenAffix(item: Item) {
  const c = affixCounts(item)
  const l = affixLimits(item)
  return c.prefix < l.prefix || c.suffix < l.suffix
}

const hasStat = (item: Item, stat: string) => item.explicits.some((m) => MODS[m.id].stats.some(([s]) => s === stat))

// Bench meta-crafts
export const metamods = (item: Item) => ({
  lockPrefixes: hasStat(item, 'item_generation_cannot_change_prefixes'),
  lockSuffixes: hasStat(item, 'item_generation_cannot_change_suffixes'),
  noAttack: hasStat(item, 'item_generation_cannot_roll_attack_affixes'),
  noCaster: hasStat(item, 'item_generation_cannot_roll_caster_affixes'),
  multiCraft: hasStat(item, 'item_generation_can_have_multiple_crafted_mods'),
})

// Mods a currency may remove or reroll: fractured mods never change, meta-crafts protect their side.
export function changeable(item: Item, m: RolledMod) {
  if (m.fractured) return false
  const lock = metamods(item)
  return isPrefix(m) ? !lock.lockPrefixes : !lock.lockSuffixes
}

export function itemTags(item: Item): Set<string> {
  const base = BASES[item.base]
  const tags = new Set(base.tags)
  for (const i of item.influences) tags.add(CLASS_INFLUENCE_TAGS[base.cls][i])
  for (const m of item.explicits) for (const t of MODS[m.id].adds ?? []) tags.add(t)
  return tags
}

// PoE rule: the first listed tag the item has decides the weight.
const firstMatch = (list: [string, number][], tags: Set<string>) => list.find(([t]) => tags.has(t))?.[1]

export function spawnWeight(id: string, tags: Set<string>): number {
  const m = MODS[id]
  const gw = m.gw ? (firstMatch(m.gw, tags) ?? 100) : 100
  return ((firstMatch(m.spawn, tags) ?? 0) * gw) / 100
}

// Explicit mods that can randomly roll on this base/ilvl/influence combo; cached because spam crafting calls this a lot.
const candidateCache = new Map<string, string[]>()
function candidates(item: Item): string[] {
  const key = `${item.base}|${item.ilvl}|${item.influences.join()}`
  let ids = candidateCache.get(key)
  if (!ids) {
    const tags = itemTags({ ...item, explicits: [] })
    ids = Object.keys(MODS).filter((id) => {
      const m = MODS[id]
      return !m.dom && (m.gen === 'prefix' || m.gen === 'suffix') && m.lvl <= item.ilvl && spawnWeight(id, tags) > 0
    })
    candidateCache.set(key, ids)
  }
  return ids
}

// Fossils (and anything else) can add their own mods to the pool and reweight it.
export interface RollOptions {
  extra?: string[] // additional mod ids (fossil-only mods), using their own spawn weights
  weight?: (id: string) => number // multiplier on spawn weight
  lucky?: boolean
  maxLevel?: number // low-tier essences cap the level of the random mods they roll
  ignoreMeta?: boolean // "Cannot roll Attack/Caster Modifiers" don't apply (prefix/suffix beasts)
}

// Mods that could be added right now: open affix side, no mod group already on the item, not blocked by meta-crafts.
export function modPool(item: Item, extra: string[] = [], maxLevel = Infinity, ignoreMeta = false): string[] {
  const c = affixCounts(item)
  const l = affixLimits(item)
  const groups = new Set(item.explicits.flatMap((m) => MODS[m.id].grp))
  const meta = ignoreMeta ? { noAttack: false, noCaster: false } : metamods(item)
  const tags = itemTags({ ...item, explicits: [] })
  const extraOk = extra.filter((id) => MODS[id] && MODS[id].lvl <= item.ilvl && spawnWeight(id, tags) > 0)
  return [...candidates(item), ...extraOk].filter((id) => {
    const m = MODS[id]
    const full = m.gen === 'prefix' ? c.prefix >= l.prefix : c.suffix >= l.suffix
    if (full || m.lvl > maxLevel || m.grp.some((g) => groups.has(g))) return false
    if (meta.noAttack && m.tags?.includes('attack')) return false
    if (meta.noCaster && m.tags?.includes('caster')) return false
    return true
  })
}

export function addRandomMod(item: Item, rng: Rng, o: RollOptions = {}): Item | undefined {
  const tags = itemTags(item)
  const weight = (id: string) => spawnWeight(id, tags) * (o.weight?.(id) ?? 1)
  const id = pickWeighted(rng, modPool(item, o.extra, o.maxLevel, o.ignoreMeta), weight)
  return id === undefined ? undefined : { ...item, explicits: [...item.explicits, rollMod(id, rng, o.lucky)] }
}
