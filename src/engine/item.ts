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
  log?: CraftStep[] // crafting history that still matters for the expected cost (game/history.ts)
}

export const fractured = (i: Item) => i.explicits.some((m) => m.fractured)

// Drop-only options (D42): "Body Armour:dex_armour" -> that class with that armour tag; a plain class matches any base.
export const onBase = (base: string, on: string[]) => on.some((o) => {
  const [cls, tag] = o.split(':')
  return BASES[base].cls === cls && (!tag || BASES[base].tags.includes(tag))
})

// ---- Defences on armour pieces: (base + flat local options) x (1 + (increased local options + quality) / 100). The base
// value is the top of the base's range (user: no base roll, there's no Sacred Orb in this game).
export type Defence = 'armour' | 'evasion' | 'es' | 'ward'
const DEFENCE_PROP: Record<Defence, string> = { armour: 'armour', evasion: 'evasion', es: 'energy_shield', ward: 'ward' }
const DEFENCE_FLAT: Record<Defence, string> = {
  armour: 'local_base_physical_damage_reduction_rating', evasion: 'local_base_evasion_rating', es: 'local_energy_shield', ward: 'local_ward',
}
const DEFENCE_INC: Record<Defence, string[]> = {
  armour: ['local_physical_damage_reduction_rating_+%', 'local_armour_and_evasion_+%', 'local_armour_and_energy_shield_+%', 'local_armour_and_evasion_and_energy_shield_+%'],
  evasion: ['local_evasion_rating_+%', 'local_armour_and_evasion_+%', 'local_evasion_and_energy_shield_+%', 'local_armour_and_evasion_and_energy_shield_+%'],
  es: ['local_energy_shield_+%', 'local_armour_and_energy_shield_+%', 'local_evasion_and_energy_shield_+%', 'local_armour_and_evasion_and_energy_shield_+%'],
  ward: ['local_ward_+%'],
}
export const isDefenceStat = (sid: string) => Object.values(DEFENCE_FLAT).includes(sid) || Object.values(DEFENCE_INC).some((s) => s.includes(sid))
export const defenceFlat = (d: Defence) => DEFENCE_FLAT[d]
export const defenceInc = (d: Defence) => DEFENCE_INC[d]
export const baseDefence = (base: string, d: Defence): number => {
  const p = BASES[base].props[DEFENCE_PROP[d]]
  return typeof p === 'object' ? p.max : p ?? 0
}
export function defences(item: Item): Partial<Record<Defence, number>> {
  const sum = (ids: string[]) => [...item.implicits, ...item.explicits]
    .reduce((s, m) => s + MODS[m.id].stats.reduce((t, [sid], i) => t + (ids.includes(sid) ? m.values[i] : 0), 0), 0)
  const out: Partial<Record<Defence, number>> = {}
  for (const d of Object.keys(DEFENCE_PROP) as Defence[]) {
    const base = baseDefence(item.base, d)
    if (base > 0) out[d] = Math.round((base + sum([DEFENCE_FLAT[d]])) * (1 + (sum(DEFENCE_INC[d]) + (item.quality ?? 0)) / 100))
  }
  return out
}

// ---- Weapon damage (user: attack weapons are judged by DPS the way armour is by defence). The item's own numbers, from
// local options: physical (base + added) x (1 + (increased + quality) / 100), elemental and chaos added, attacks per second
// x (1 + increased attack speed / 100), critical strike chance x (1 + increased / 100). DPS = average hit x attacks per second.
export type DpsKind = 'phys' | 'ele' | 'total'
const ELEMENTS = ['fire', 'cold', 'lightning']
const added = (kind: string) => [`local_minimum_added_${kind}_damage`, `local_maximum_added_${kind}_damage`]
// The options that move DPS (critical strike chance doesn't, as on the trade site). Added chaos counts in the total.
export const DPS_STATS = ['local_physical_damage_+%', ...added('physical'), 'local_attack_speed_+%', ...ELEMENTS.flatMap(added), ...added('chaos')]
export interface WeaponStats { phys: [number, number]; ele: [number, number]; chaos: [number, number]; aps: number; crit: number; dps: Record<DpsKind, number> }
export function weaponStats(item: Item): WeaponStats | undefined {
  const p = BASES[item.base].props as Record<string, number>
  if (!p.attack_time) return undefined
  const sum = (sid: string) => [...item.implicits, ...item.explicits]
    .reduce((s, m) => s + MODS[m.id].stats.reduce((t, [x], i) => t + (x === sid ? m.values[i] : 0), 0), 0)
  const pair = (kinds: string[]): [number, number] => [0, 1].map((k) => kinds.reduce((s, kind) => s + sum(added(kind)[k]), 0)) as [number, number]
  const inc = 1 + (sum('local_physical_damage_+%') + (item.quality ?? 0)) / 100
  const [a, b] = pair(['physical'])
  const phys: [number, number] = [Math.round((p.physical_damage_min + a) * inc), Math.round((p.physical_damage_max + b) * inc)]
  const ele = pair(ELEMENTS)
  const chaos = pair(['chaos'])
  const aps = (1000 / p.attack_time) * (1 + sum('local_attack_speed_+%') / 100)
  const crit = (p.critical_strike_chance / 100) * (1 + sum('local_critical_strike_chance_+%') / 100)
  const per = ([x, y]: [number, number]) => ((x + y) / 2) * aps
  return { phys, ele, chaos, aps, crit, dps: { phys: per(phys), ele: per(ele), total: per(phys) + per(ele) + per(chaos) } }
}
// The bare base's physical DPS (the shop list, the order bars).
export const baseDps = (base: string) =>
  weaponStats({ base, ilvl: 1, rarity: 'normal', implicits: [], explicits: [], influences: [] })?.dps.phys ?? 0

// One craft in an item's history (see game/history.ts).
export interface CraftStep {
  key: string // what was done, e.g. "cur:chaos", "ess:Deafening Essence of Greed"
  cost: number // gold paid
  m: number // high-efficiency useful options on the result
  before: Item // the item it was applied to (no history)
  created: string[] // mod ids the step added
  structural: boolean // changed the rarity (transmute, alchemy, regal...)
  other?: Item // second item of an Awakener's Orb / recombinator
  extra?: number // expected cost of that second item
  fixed?: boolean // always counts (mirror)
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

// Some bases change the limits through their implicit (e.g. Simplex Amulet: 1 prefix / 2 suffixes). A magic item has
// at most one of each, and none on a side its base allows none of (Ratcheting Ring 0/6, Composite Ring 6/0).
export function affixLimits(item: Item) {
  if (item.rarity === 'normal') return { prefix: 0, suffix: 0 }
  let prefix = 3
  let suffix = 3
  for (const m of item.implicits) {
    MODS[m.id].stats.forEach(([sid], i) => {
      if (sid === 'local_maximum_prefixes_allowed_+') prefix += m.values[i]
      if (sid === 'local_maximum_suffixes_allowed_+') suffix += m.values[i]
    })
  }
  return item.rarity === 'magic' ? { prefix: Math.min(1, prefix), suffix: Math.min(1, suffix) } : { prefix, suffix }
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
  if (item.implicits.some((m) => MODS[m.id].stats.some(([s]) => s === NO_CASTER_IMPLICIT))) tags.add(NO_CASTER)
  return tags
}

// Attack wands (Somatic, Blasting, Kinetic) have the implicit "Cannot roll Caster Modifiers" (poedb: Kinetic Wand). The
// mod data has no tag for it, so itemTags marks those items and no caster-tagged prefix or suffix ever rolls on them,
// whatever the craft (user-reported: a Harvest speed reforge gave a Kinetic Wand cast speed). Unlike the bench
// meta-craft, beasts don't get around it: it's the base. ponytail: bench crafts and essence mods aren't rolled and stay
// allowed; unverified either way.
const NO_CASTER_IMPLICIT = 'kinetic_wand_implicit_cannot_roll_caster_modifiers'
const NO_CASTER = 'cannot_roll_caster_modifiers'
export const noCasterBase = (base: string) => BASES[base].imp.some((id) => MODS[id].stats.some(([s]) => s === NO_CASTER_IMPLICIT))

// PoE rule: the first listed tag the item has decides the weight.
const firstMatch = (list: [string, number][], tags: Set<string>) => list.find(([t]) => tags.has(t))?.[1]

export function spawnWeight(id: string, tags: Set<string>): number {
  const m = MODS[id]
  if (tags.has(NO_CASTER) && (m.gen === 'prefix' || m.gen === 'suffix') && m.tags?.includes('caster')) return 0
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
