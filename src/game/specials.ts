// Special offers (D42): rare items that only drop somewhere this game has no content for, sold in the shop at a high
// price because the drop-only option on them can't be crafted (players often fracture it, then craft around it).
// - Breach: a Grasping Mail from 60 Breach Rings, with 1-3 Breachlord options (50/33/17%, by their weights).
// - Delve: an item from an Azurite Mine node with one Delve drop-only option (item level 83 at most).
// - Incursion: an item from the Temple of Atzoatl with one Incursion option.
// Every day brings one of each; buying takes it off the board. Price: FINISH_SHARE of what the item is worth once crafted
// up for the build that wants its option most (value.ts finishedValue), never below SPECIAL_MARKUP x the plain base, so
// buying one to sell it straight back loses, and the option has to be crafted around to pay.
import { fill, rareModCount } from '../engine/currency.ts'
import { BASES, MODS } from '../engine/data.ts'
import { newItem, rollMod, type Item } from '../engine/item.ts'
import { int, pickWeighted, type Rng } from '../engine/rng.ts'
import type { Meta } from './meta.ts'
import { basePrice, buyableBases } from './shop.ts'
import { finishedValue } from './value.ts'

export type DropSource = 'breach' | 'delve' | 'incursion'
export interface Special { id: number; source: DropSource; item: Item; price: number }

export const SPECIAL_MARKUP = 2
export const FINISH_SHARE = 0.5
export const SPECIAL_ILVL = 83
export const GRASPING_MAIL = 'Metadata/Items/Armours/BodyArmours/BodyStrDexInt2'
const BREACH_COUNT = [3, 2, 1] // 1, 2 or 3 Breachlord options: 50 / 33 / 17%

const dropMods = (source: DropSource) => Object.keys(MODS).filter((id) => MODS[id].drop === source)
// "Body Armour:dex_armour" -> that class with that armour tag; plain class names match any base of the class.
const fits = (base: string, on: string[]) => on.some((o) => {
  const [cls, tag] = o.split(':')
  return BASES[base].cls === cls && (!tag || BASES[base].tags.includes(tag))
})

function breachItem(rng: Rng): Item {
  const n = 1 + (pickWeighted(rng, [0, 1, 2], (k) => BREACH_COUNT[k]) ?? 0)
  let pool = dropMods('breach')
  let item: Item = { ...newItem(GRASPING_MAIL, SPECIAL_ILVL, rng), rarity: 'rare' }
  for (let k = 0; k < n; k++) {
    const id = pickWeighted(rng, pool, (x) => MODS[x].dw ?? 0)!
    item = { ...item, explicits: [...item.explicits, rollMod(id, rng)] }
    pool = pool.filter((x) => !MODS[x].grp.some((g) => MODS[id].grp.includes(g)))
  }
  return item
}

// One drop option on one of the better ordinary bases it can be on (not the experimental / special ones that never drop
// from these sources and cost a fortune in the shop).
function dropItem(source: DropSource, rng: Rng): Item {
  const pool = dropMods(source)
  const id = pool[int(rng, 0, pool.length - 1)]
  const bases = buyableBases().filter((b) => fits(b, MODS[id].on ?? []) && !BASES[b].tags.includes('not_for_sale'))
    .sort((a, b) => BASES[b].lvl - BASES[a].lvl).slice(0, 5)
  const base = bases[int(rng, 0, bases.length - 1)]
  return { ...newItem(base, SPECIAL_ILVL, rng), rarity: 'rare', explicits: [rollMod(id, rng)] }
}

export function makeSpecial(id: number, source: DropSource, day: number, meta: Meta, rng: Rng): Special {
  const core = source === 'breach' ? breachItem(rng) : dropItem(source, rng)
  // The rest is an ordinary rare roll around the drop option(s).
  const item = fill(core, Math.max(0, rareModCount(rng) - core.explicits.length), rng)
  const floor = SPECIAL_MARKUP * basePrice(item.base, item.ilvl, day)
  return { id, source, item, price: Math.round(Math.max(FINISH_SHARE * finishedValue(item, day, meta), floor)) }
}

// Start of a day: yesterday's offers are gone, one of each source comes in.
export const refreshSpecials = (day: number, meta: Meta, rng: Rng): Special[] =>
  (['breach', 'delve', 'incursion'] as const).map((source, k) => makeSpecial(day * 10 + k, source, day, meta, rng))
