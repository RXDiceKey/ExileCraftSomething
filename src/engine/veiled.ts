// Veiled crafting: Veiled Chaos/Exalted Orbs put a "Veiled" / "of the Veil" placeholder on a rare; unveiling offers three
// random unveiled mods to pick from. Rules: PoE Wiki "Veiled modifier", "Veiled Chaos Orb", "Veiled Exalted Orb" and the
// Metamod table (Veiled Exalted: Prefixes/Suffixes Cannot Be Changed respected, Attack/Caster ones ignored).
import { keepLocked, rareModCount } from './currency.ts'
import { MODS } from './data.ts'
import { addRandomMod, affixCounts, affixLimits, changeable, editable, itemTags, rollMod, spawnWeight, type Item, type RolledMod } from './item.ts'
import { int, pickWeighted, type Rng } from './rng.ts'

export const VEILED_CHAOS = 'Veiled Chaos Orb'
export const VEILED_EXALT = 'Veiled Exalted Orb'
const PLACEHOLDER = { prefix: 'VeiledPrefix', suffix: 'VeiledSuffix' } as const
export const isVeiled = (m: RolledMod) => MODS[m.id].dom === 'veiled'
// Unveiling is the one thing a veiled item allows; Veiled Chaos/Exalted need `editable` (no veiled mod yet: "This item
// already has a veiled Mod").
const touchable = (i: Item) => !i.corrupted && !i.mirrored

// Sides with room for one more mod.
function openSides(i: Item): ('prefix' | 'suffix')[] {
  const c = affixCounts(i)
  const l = affixLimits(i)
  return [...(c.prefix < l.prefix ? ['prefix' as const] : []), ...(c.suffix < l.suffix ? ['suffix' as const] : [])]
}
const addVeiled = (i: Item, rng: Rng): Item => {
  const sides = openSides(i)
  if (!sides.length) return i
  const side = sides[int(rng, 0, sides.length - 1)]
  return { ...i, explicits: [...i.explicits, rollMod(PLACEHOLDER[side], rng)] }
}

// ---- Veiled Chaos Orb: reforges a rare like a Chaos Orb (locks kept), one of the new mods being veiled.
export const canVeiledChaos = (i: Item) => editable(i) && i.rarity === 'rare' && openSides(keepLocked(i)).length > 0
export function applyVeiledChaos(i: Item, rng: Rng): Item {
  let out = addVeiled({ ...keepLocked(i), rarity: 'rare' }, rng)
  const total = rareModCount(rng)
  while (out.explicits.length < total) {
    const more = addRandomMod(out, rng)
    if (!more) break
    out = more
  }
  return out
}

// ---- Veiled Exalted Orb: on a rare, removes a random mod (not a locked side, not fractured), then adds a veiled mod.
const removable = (i: Item) => i.explicits.filter((m) => changeable(i, m))
export const canVeiledExalt = (i: Item) => editable(i) && i.rarity === 'rare' && removable(i).length > 0
export function applyVeiledExalt(i: Item, rng: Rng): Item {
  const xs = removable(i)
  const gone = xs[int(rng, 0, xs.length - 1)]
  return addVeiled({ ...i, explicits: i.explicits.filter((m) => m !== gone) }, rng)
}

// ---- Unveiling: three different unveiled mods for that side, weighted by their spawn weights on this item (item level
// and mod groups already on the item respected). They are rolled once, the first time the player looks, and kept on the
// placeholder so reopening doesn't reroll them.
export const UNVEIL_CHOICES = 3
export function unveilChoices(item: Item, veiled: RolledMod, rng: Rng): string[] {
  const tags = itemTags({ ...item, explicits: [] })
  const groups = new Set(item.explicits.filter((m) => m !== veiled).flatMap((m) => MODS[m.id].grp))
  let pool = Object.keys(MODS).filter((id) => MODS[id].dom === 'unveiled' && MODS[id].gen === MODS[veiled.id].gen
    && MODS[id].lvl <= item.ilvl && spawnWeight(id, tags) > 0 && !MODS[id].grp.some((g) => groups.has(g)))
  const picks: string[] = []
  while (picks.length < UNVEIL_CHOICES && pool.length) {
    const id = pickWeighted(rng, pool, (x) => spawnWeight(x, tags))!
    picks.push(id)
    pool = pool.filter((x) => !MODS[x].grp.some((g) => MODS[id].grp.includes(g)))
  }
  return picks
}
export const canReveal = (i: Item) => touchable(i) && i.explicits.some((m) => isVeiled(m) && !m.unveil)
// Rolls the choices for the first veiled mod that has none yet.
export function reveal(i: Item, rng: Rng): Item {
  const target = i.explicits.find((m) => isVeiled(m) && !m.unveil)!
  return { ...i, explicits: i.explicits.map((m) => (m === target ? { ...m, unveil: unveilChoices(i, m, rng) } : m)) }
}
// Turns the veiled mod into the chosen one (a fresh roll of it). A choice that clashes with a mod group added after the
// choices were rolled can't be taken.
export function canUnveil(i: Item, choice: string): boolean {
  const target = i.explicits.find((m) => m.unveil?.includes(choice))
  if (!touchable(i) || !target) return false
  const groups = new Set(i.explicits.filter((m) => m !== target).flatMap((m) => MODS[m.id].grp))
  return !MODS[choice].grp.some((g) => groups.has(g))
}
export function unveil(i: Item, choice: string, rng: Rng): Item {
  const target = i.explicits.find((m) => m.unveil?.includes(choice))!
  return { ...i, explicits: i.explicits.map((m) => (m === target ? rollMod(choice, rng) : m)) }
}
