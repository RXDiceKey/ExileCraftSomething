// Special offers (D42): bases sold unidentified with an option that only drops somewhere this game has no content for.
// The option is rolled the moment the base is bought: one of those this base can have (Breach: 1-3 Breachlord options
// on a Grasping Mail, 50/33/17%, by their weights), the rest an ordinary rare roll.
// Price (user): the plain base x UNID_MARKUP plus what a sure, useful option is worth on that slot x the chance of
// rolling a useful one; few possible options that buyers want = dear, many = cheap.
import { fill, rareModCount } from '../engine/currency.ts'
import { BASES, MODS } from '../engine/data.ts'
import { newItem, onBase, rollMod, type Item } from '../engine/item.ts'
import { int, pickWeighted, type Rng } from '../engine/rng.ts'
import { basePrice, GOLD_PER_CHAOS } from './shop.ts'
import { dropAppeal, slotBudget } from './value.ts'

export type DropSource = 'breach' | 'delve' | 'incursion'
export const DROP_SOURCES: DropSource[] = ['breach', 'delve', 'incursion']

export const SPECIAL_ILVL = 83 // Delve items are capped at 83; the others drop around there too
export const GRASPING_MAIL = 'Metadata/Items/Armours/BodyArmours/BodyStrDexInt2'
export const UNID_MARKUP = 1.5
export const UNID_VALUE = 0.75 // chaos per point of slot budget for a sure useful option (about half a crafted-up item)
const BREACH_COUNT = [3, 2, 1] // 1, 2 or 3 Breachlord options: 50 / 33 / 17%

export const SACRIFICIAL_GARB = 'Metadata/Items/Armours/BodyArmours/BodyStrDexInt1'
// Bases that only drop in their own content (user: a Grasping Mail never comes out of Delve): Grasping Mail from
// Breach, Sacrificial Garb from Ritual, the experimental bases from Heist. Atlas bases drop in any map, Delve included.
const contentOf = (base: string) => base === GRASPING_MAIL ? 'breach'
  : base === SACRIFICIAL_GARB ? 'ritual' : BASES[base].tags.includes('experimental_base') ? 'heist' : undefined

// The drop options a base can come with: its own content's, if it has one; Breach's only on a Grasping Mail. None on a
// base that doesn't drop at SPECIAL_ILVL.
export function dropOptions(source: DropSource, base: string): string[] {
  const own = contentOf(base)
  if (BASES[base].lvl > SPECIAL_ILVL || (own ? own !== source : source === 'breach')) return []
  return Object.keys(MODS).filter((id) => MODS[id].drop === source && (source === 'breach' || onBase(base, MODS[id].on ?? [])))
}

// Chance the roll gives at least one option some buyer of this base wants.
function usefulChance(source: DropSource, base: string): number {
  const all = dropOptions(source, base)
  if (!all.length) return 0
  if (source !== 'breach') return all.filter((id) => dropAppeal(id, base)).length / all.length
  const total = all.reduce((s, id) => s + (MODS[id].dw ?? 0), 0)
  const u = all.filter((id) => dropAppeal(id, base)).reduce((s, id) => s + (MODS[id].dw ?? 0), 0) / total
  const counts = BREACH_COUNT.reduce((a, b) => a + b, 0)
  return BREACH_COUNT.reduce((s, w, k) => s + (w / counts) * (1 - (1 - u) ** (k + 1)), 0)
}

// 0 when the base can't carry that source's options.
export const unidentifiedPrice = (source: DropSource, base: string, day: number) => !dropOptions(source, base).length ? 0
  : Math.round(UNID_MARKUP * basePrice(base, SPECIAL_ILVL, day)
    + slotBudget(BASES[base].cls) * GOLD_PER_CHAOS * UNID_VALUE * usefulChance(source, base))

export function rollUnidentified(source: DropSource, base: string, rng: Rng): Item {
  let item: Item = { ...newItem(base, SPECIAL_ILVL, rng), rarity: 'rare' }
  let pool = dropOptions(source, base)
  const n = source === 'breach' ? 1 + (pickWeighted(rng, [0, 1, 2], (k) => BREACH_COUNT[k]) ?? 0) : 1
  for (let k = 0; k < n && pool.length; k++) {
    const id = source === 'breach' ? pickWeighted(rng, pool, (x) => MODS[x].dw ?? 0)! : pool[int(rng, 0, pool.length - 1)]
    item = { ...item, explicits: [...item.explicits, rollMod(id, rng)] }
    pool = pool.filter((x) => !MODS[x].grp.some((g) => MODS[id].grp.includes(g)))
  }
  return fill(item, Math.max(0, rareModCount(rng) - item.explicits.length), rng)
}
