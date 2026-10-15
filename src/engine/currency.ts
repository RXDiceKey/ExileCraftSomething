import { BASES, MODS } from './data.ts'
import { addRandomMod, changeable, editable, hasOpenAffix, itemTags, rollMod, spawnWeight, type Item, type RollOptions } from './item.ts'
import { int, next, pickWeighted, type Rng } from './rng.ts'

export type CurrencyId =
  | 'transmutation' | 'alteration' | 'augmentation' | 'regal' | 'alchemy' | 'binding'
  | 'chaos' | 'exalted' | 'annulment' | 'divine' | 'blessed' | 'scouring'
  | 'vaal' | 'fracturing' | 'whetstone' | 'scrap'

interface Currency {
  can: (item: Item) => boolean
  apply: (item: Item, rng: Rng) => Item
}

const is = (...rarities: Item['rarity'][]) => (i: Item) => editable(i) && rarities.includes(i.rarity)

// Adds up to n random mods; stops early if the item runs out of room or eligible mods.
export function fill(item: Item, n: number, rng: Rng, o?: RollOptions): Item {
  for (let k = 0; k < n; k++) item = addRandomMod(item, rng, o) ?? item
  return item
}

// ponytail: assumed 50/50 for 1 vs 2 mods on magic items (PoE1 doesn't publish it); tune if data turns up.
export const magicModCount = (rng: Rng) => (next(rng) < 0.5 ? 1 : 2)
// Rare items roll 4/5/6 mods at 8:3:1.
export const rareModCount = (rng: Rng) => {
  const r = next(rng) * 12
  return r < 8 ? 4 : r < 11 ? 5 : 6
}

// Reroll everything that can change; fractured mods and the side protected by "Prefixes/Suffixes Cannot Be Changed" stay
// (PoE Wiki, Metamod: Chaos/Alteration respect the lock, open slots on that side may still be filled).
export const keepLocked = (i: Item): Item => ({ ...i, explicits: i.explicits.filter((m) => !changeable(i, m)) })
export const rerollRare = (i: Item, rng: Rng, o?: RollOptions, forced: string[] = []): Item => {
  let item: Item = { ...keepLocked(i), rarity: 'rare' }
  for (const id of forced) item = { ...item, explicits: [...item.explicits, rollMod(id, rng, o?.lucky)] }
  return fill(item, rareModCount(rng) - item.explicits.length, rng, o)
}

const WEAPON = (cls: string) => !['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield', 'Quiver', 'Ring', 'Amulet', 'Belt'].includes(cls)
const ARMOUR = (cls: string) => ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield'].includes(cls)
// Quality per Whetstone/Scrap since 3.25: set by item level, not rarity (PoE Wiki "Quality", Amount table).
// Expected % per use for item level 1..100; each use adds it rounded down or up at random so the average matches.
const QUALITY_PER_USE = [
  20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 19.81, 19.15, 18.513, 17.896,
  17.299, 16.722, 16.164, 15.625, 15.102, 14.598, 14.109, 13.637, 13.18, 12.738, 12.311, 11.897, 11.497, 11.111, 10.736,
  10.375, 10.025, 9.686, 9.359, 9.042, 8.736, 8.44, 8.153, 7.876, 7.608, 7.349, 7.098, 6.855, 6.621, 6.394,
  6.175, 5.962, 5.757, 5.558, 5.366, 5.181, 5.001, 4.827, 4.659, 4.496, 4.339, 4.187, 4.04, 3.898, 3.76,
  3.627, 3.498, 3.374, 3.253, 3.137, 3.024, 2.915, 2.81, 2.708, 2.609, 2.514, 2.421, 2.332, 2.246, 2.163,
  2.082, 2.004, 1.928, 1.855, 1.784, 1.716, 1.65, 1.586, 1.524, 1.465, 1.407, 1.351, 1.297, 1.244, 1.194,
  1.145, 1.097, 1.051, 1.007, 1, 1, 1, 1, 1, 1,
]
export function qualityStep(ilvl: number, rng: Rng): number {
  const e = QUALITY_PER_USE[Math.min(100, Math.max(1, ilvl)) - 1]
  return Math.floor(e) + (next(rng) < e % 1 ? 1 : 0)
}
const addQuality = (i: Item, rng: Rng): Item => ({ ...i, quality: Math.min(20, (i.quality ?? 0) + qualityStep(i.ilvl, rng)) })

export const CURRENCIES: Record<CurrencyId, Currency> = {
  transmutation: {
    can: is('normal'),
    apply: (i, rng) => fill({ ...i, rarity: 'magic' }, magicModCount(rng), rng),
  },
  alteration: {
    can: is('magic'),
    apply: (i, rng) => {
      const kept = keepLocked(i)
      return fill(kept, magicModCount(rng) - kept.explicits.length, rng)
    },
  },
  augmentation: {
    can: (i) => is('magic')(i) && hasOpenAffix(i),
    apply: (i, rng) => fill(i, 1, rng),
  },
  regal: {
    can: is('magic'),
    apply: (i, rng) => fill({ ...i, rarity: 'rare' }, 1, rng),
  },
  alchemy: {
    can: is('normal'),
    apply: (i, rng) => fill({ ...i, rarity: 'rare' }, rareModCount(rng), rng),
  },
  // Orb of Binding also links sockets; sockets aren't modelled, so it rolls like Alchemy.
  binding: {
    can: is('normal'),
    apply: (i, rng) => fill({ ...i, rarity: 'rare' }, rareModCount(rng), rng),
  },
  chaos: {
    can: is('rare'),
    apply: (i, rng) => rerollRare(i, rng),
  },
  exalted: {
    can: (i) => is('rare')(i) && hasOpenAffix(i),
    apply: (i, rng) => fill(i, 1, rng),
  },
  annulment: {
    can: (i) => is('magic', 'rare')(i) && i.explicits.some((m) => changeable(i, m)),
    apply: (i, rng) => {
      const options = i.explicits.filter((m) => changeable(i, m))
      const gone = options[int(rng, 0, options.length - 1)]
      return { ...i, explicits: i.explicits.filter((m) => m !== gone) }
    },
  },
  divine: {
    can: (i) => is('magic', 'rare')(i) && i.explicits.some((m) => changeable(i, m) && !m.crafted),
    apply: (i, rng) => ({ ...i, explicits: i.explicits.map((m) => (changeable(i, m) && !m.crafted ? rollMod(m.id, rng) : m)) }),
  },
  blessed: {
    can: (i) => editable(i) && i.implicits.some((m) => MODS[m.id].stats.some(([, a, b]) => a !== b)),
    apply: (i, rng) => ({ ...i, implicits: i.implicits.map((m) => rollMod(m.id, rng)) }),
  },
  scouring: {
    can: (i) => is('magic', 'rare')(i) && i.explicits.some((m) => changeable(i, m)),
    apply: (i) => {
      const explicits = i.explicits.filter((m) => !changeable(i, m))
      return { ...i, explicits, rarity: explicits.length ? i.rarity : 'normal' }
    },
  },
  // Vaal Orb (sockets aren't modelled, so the socket outcome is "nothing happens"):
  // 50% no change, 25% a corruption implicit (replaces one implicit at random), 25% "bricked": becomes a rare with six
  // random affixes, respecting meta-crafts (PoE Wiki, Vaal Orb). Always corrupts.
  vaal: {
    can: editable,
    apply: (i, rng) => {
      const r = next(rng)
      const corrupted = { ...i, corrupted: true as const }
      if (r < 0.5) return corrupted
      if (r < 0.75) {
        const tags = itemTags(i)
        const pool = Object.keys(MODS).filter((id) => MODS[id].gen === 'corrupted' && spawnWeight(id, tags) > 0)
        const id = pickWeighted(rng, pool, (id) => spawnWeight(id, tags))
        if (!id) return corrupted
        const k = i.implicits.length ? int(rng, 0, i.implicits.length - 1) : 0
        return { ...corrupted, implicits: [...i.implicits.slice(0, k), rollMod(id, rng), ...i.implicits.slice(k + 1)] }
      }
      const brick: Item = { ...keepLocked(i), rarity: 'rare' }
      return { ...fill(brick, 6 - brick.explicits.length, rng), corrupted: true }
    },
  },
  fracturing: {
    // "Cannot Fracture Influenced or Fractured Items"
    can: (i) => is('rare')(i) && i.explicits.length >= 4 && !i.explicits.some((m) => m.fractured) && !i.influences.length
      && i.explicits.some((m) => !m.crafted),
    apply: (i, rng) => {
      const options = i.explicits.filter((m) => !m.crafted)
      const pick = options[int(rng, 0, options.length - 1)]
      return { ...i, explicits: i.explicits.map((m) => (m === pick ? { ...m, fractured: true as const } : m)) }
    },
  },
  whetstone: {
    can: (i) => editable(i) && WEAPON(BASES[i.base].cls) && (i.quality ?? 0) < 20,
    apply: addQuality,
  },
  scrap: {
    can: (i) => editable(i) && ARMOUR(BASES[i.base].cls) && (i.quality ?? 0) < 20,
    apply: addQuality,
  },
}
