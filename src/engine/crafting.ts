// Bench crafts, essences and fossils.
import craftingJson from '../data/crafting.json' with { type: 'json' }
import { fracture, keepLocked, rerollRare } from './currency.ts'
import { BASES, MODS } from './data.ts'
import { affixCounts, affixLimits, editable, fractured, metamods, rollMod, type Item } from './item.ts'
import { int, type Rng } from './rng.ts'

interface BenchOption { mod: string; classes: string[]; cost: number }
interface EssenceDef { level: number; ilvlMax: number | null; mods: Record<string, string> }
interface FossilDef {
  pos: [string, number][]
  neg: [string, number][]
  added: string[]
  forbidden: string[]
  allowed: string[]
  lucky: boolean
}
export const CRAFTING = craftingJson as {
  bench: BenchOption[]
  essences: Record<string, EssenceDef>
  fossils: Record<string, FossilDef>
  currencies: Record<string, { ko: string; icon: string; cat: string }>
}


// Essences and fossils refuse items with a meta-craft other than multimod ("You can't use this currency on items with a
// modifier that affects mod outcomes").
export const hasOutcomeMetamod = (i: Item) => {
  const m = metamods(i)
  return m.lockPrefixes || m.lockSuffixes || m.noAttack || m.noCaster
}

// ---- Crafting bench
export const craftedCount = (i: Item) => i.explicits.filter((m) => m.crafted).length

// Options the bench offers for this item right now (index into CRAFTING.bench). With a crafted option it would swap out
// (see swapsCrafted), what the item offers without it.
export function benchOptions(item: Item): number[] {
  if (swapsCrafted(item)) return benchOptions(removeCrafted(item))
  if (!editable(item) || item.rarity === 'normal') return []
  const cls = BASES[item.base].cls
  const c = affixCounts(item)
  const l = affixLimits(item)
  const groups = new Set(item.explicits.flatMap((m) => MODS[m.id].grp))
  const maxCrafted = metamods(item).multiCraft ? 3 : 1
  if (craftedCount(item) >= maxCrafted) return []
  return CRAFTING.bench.flatMap((o, i) => {
    const m = MODS[o.mod]
    if (!m || !o.classes.includes(cls) || m.grp.some((g) => groups.has(g))) return []
    const full = m.gen === 'prefix' ? c.prefix >= l.prefix : c.suffix >= l.suffix
    return full ? [] : [i]
  })
}

export function applyBench(item: Item, index: number, rng: Rng): Item {
  const base = swapsCrafted(item) ? removeCrafted(item) : item
  return { ...base, explicits: [...base.explicits, { ...rollMod(CRAFTING.bench[index].mod, rng), crafted: true }] }
}

// A fractured crafted mod stays (fractured mods can't be removed).
export const removable = (i: Item) => i.explicits.some((m) => m.crafted && !m.fractured)
export const removeCrafted = (item: Item): Item => ({ ...item, explicits: item.explicits.filter((m) => !m.crafted || m.fractured) })
// The bench swaps a crafted option for the new one (user: don't block on it): with no meta-craft on the item (those, the
// multimod included, keep their crafted options), its one crafted option is removed first, paying the scouring that
// "Remove crafted modifiers" costs. A fractured crafted option can't be removed, so it still blocks.
export const swapsCrafted = (i: Item) => craftedCount(i) === 1 && removable(i) && !Object.values(metamods(i)).some(Boolean)

// ---- Essences (PoE Wiki: Essence): every essence upgrades a normal item to rare with its guaranteed mod; only
// Screaming (tier 5) and up, plus the corrupted tier-8 ones, can also reroll a rare. Low tiers cap the level of the
// random mods they roll (mLvl) instead of refusing high-level items.
export const ESSENCE_REFORGE_TIER = 5
export function canEssence(item: Item, name: string): boolean {
  const e = CRAFTING.essences[name]
  if (!e || !editable(item) || item.rarity === 'magic' || hasOutcomeMetamod(item)) return false
  if (item.rarity === 'rare' && e.level < ESSENCE_REFORGE_TIER) return false
  const id = e.mods[BASES[item.base].cls]
  if (!id) return false
  // What survives the reforge (fractured mods) must leave room for the essence mod: no mod of its group, an open side.
  const kept = keepLocked(item)
  const c = affixCounts(kept)
  const l = affixLimits({ ...kept, rarity: 'rare' })
  return !kept.explicits.some((m) => MODS[m.id].grp.some((g) => MODS[id].grp.includes(g)))
    && (MODS[id].gen === 'prefix' ? c.prefix < l.prefix : c.suffix < l.suffix)
}

export function applyEssence(item: Item, name: string, rng: Rng): Item {
  const e = CRAFTING.essences[name]
  return rerollRare(item, rng, { maxLevel: e.ilvlMax ?? Infinity }, [e.mods[BASES[item.base].cls]])
}

// ---- Fossils (1-4) in a resonator: Alchemical on normal items, Chaotic on rares.
export const RESONATOR_SIZE = ['Primitive', 'Potent', 'Powerful', 'Prime']
export const resonatorFor = (count: number, item: Item) =>
  `${RESONATOR_SIZE[count - 1]} ${item.rarity === 'normal' ? 'Alchemical' : 'Chaotic'} Resonator`

// Fractured Fossil (3.29): fractures one of the mods it rolls; not on influenced or fractured items (PoE Wiki).
export const FRACTURED_FOSSIL = 'Fractured Fossil'
export function canFossils(item: Item, names: string[]): boolean {
  return names.length >= 1 && names.length <= 4 && new Set(names).size === names.length
    && names.every((n) => CRAFTING.fossils[n]) && editable(item) && item.rarity !== 'magic' && !hasOutcomeMetamod(item)
    && (!names.includes(FRACTURED_FOSSIL) || (!item.influences.length && !fractured(item)))
}

export function applyFossils(item: Item, names: string[], rng: Rng): Item {
  const fs = names.map((n) => CRAFTING.fossils[n])
  // Each fossil multiplies the weight of mods carrying its tags (weight 1000 = x10, 0 = never).
  const weight = (id: string) => {
    const tags = MODS[id].tags ?? []
    let w = 1
    for (const f of fs) {
      if (f.forbidden.some((t) => tags.includes(t))) return 0
      if (f.allowed.length && !f.allowed.some((t) => tags.includes(t))) return 0
      for (const [t, v] of [...f.pos, ...f.neg]) if (tags.includes(t)) w *= v / 100
    }
    return w
  }
  const made = rerollRare(item, rng, { extra: fs.flatMap((f) => f.added), weight, lucky: fs.some((f) => f.lucky) })
  return names.includes(FRACTURED_FOSSIL) ? fracture(made, made.explicits, rng) : made
}

// ---- Beastcraft: Wild Bristle Matron (야생 털짐승 어미) adds one random meta-craft that fits an open affix.
// Fill the suffixes and leave a prefix open to force "Suffixes Cannot Be Changed" (the only prefix meta-craft).
// Not allowed if the item already has a crafted mod, unless that mod is the multimod. (PoE Wiki: Wild Bristle Matron)
export const MATRON = 'Wild Bristle Matron'
const METAMOD_STATS = [
  'item_generation_cannot_change_prefixes', 'item_generation_cannot_change_suffixes',
  'item_generation_cannot_roll_attack_affixes', 'item_generation_cannot_roll_caster_affixes',
  'item_generation_can_have_multiple_crafted_mods',
]
const METAMODS = METAMOD_STATS.map((stat) => Object.keys(MODS).find((id) => MODS[id].dom === 'crafted' && MODS[id].stats[0]?.[0] === stat)!)

export function matronOptions(item: Item): string[] {
  if (!editable(item) || item.rarity === 'normal') return []
  const crafted = item.explicits.filter((m) => m.crafted)
  if (crafted.some((m) => !MODS[m.id].stats.some(([s]) => s === 'item_generation_can_have_multiple_crafted_mods'))) return []
  const c = affixCounts(item)
  const l = affixLimits(item)
  const groups = new Set(item.explicits.flatMap((m) => MODS[m.id].grp))
  return METAMODS.filter((id) => {
    const m = MODS[id]
    const full = m.gen === 'prefix' ? c.prefix >= l.prefix : c.suffix >= l.suffix
    return !full && !m.grp.some((g) => groups.has(g))
  })
}

export function applyMatron(item: Item, rng: Rng): Item {
  const options = matronOptions(item)
  const id = options[int(rng, 0, options.length - 1)]
  return { ...item, explicits: [...item.explicits, { ...rollMod(id, rng), crafted: true }] }
}
