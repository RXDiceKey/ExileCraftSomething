// Harvest (Horticrafting) crafts that touch equipment, paid in Crystallised Lifeforce. Rules: PoE Wiki "Harvest crafting",
// "List of harvest crafting options" and the Metamod table; the "more likely" weights follow Craft of Exile's FAQ.
// Not modelled: quality-type enchants (this game doesn't price quality behaviour) and currency/fragment exchanges.
import { keepLocked, magicModCount, rareModCount } from './currency.ts'
import { MODS, type Influence } from './data.ts'
import { INFLUENCES, modInfluence } from './influence.ts'
import { addRandomMod, changeable, editable, itemTags, modPool, rollMod, spawnWeight, type Item, type RolledMod, type RollOptions } from './item.ts'
import { int, type Rng } from './rng.ts'

export type Lifeforce = 'wild' | 'vivid' | 'primal' | 'sacred' | 'rancour'
export const LIFEFORCE: Record<Lifeforce, string> = {
  wild: 'Wild Crystallised Lifeforce', vivid: 'Vivid Crystallised Lifeforce', primal: 'Primal Crystallised Lifeforce',
  sacred: 'Sacred Crystallised Lifeforce', rancour: 'Crystallised Rancour',
}
export type Cost = Partial<Record<Lifeforce, number>>

export interface HarvestCraft {
  id: string // the game's HarvestCraftOptions id: its text (en/ko) comes from game data
  cost: Cost
  can: (item: Item) => boolean
  apply: (item: Item, rng: Rng) => Item
}

const pick = <T>(rng: Rng, xs: T[]) => xs[int(rng, 0, xs.length - 1)]
const hasTag = (tag: string) => (id: string) => (MODS[id].tags ?? []).includes(tag)
const only = (test: (id: string) => boolean): RollOptions => ({ weight: (id) => (test(id) ? 1 : 0) })

// Rare reforge with locks kept (Prefixes/Suffixes Cannot Be Changed respected, open slots may fill, like a Chaos Orb),
// first a guaranteed mod passing `guarantee`, then random mods up to `total` (4/5/6 like a Chaos Orb by default).
function reforge(item: Item, rng: Rng, guarantee?: (id: string) => boolean, o: RollOptions = {}, total = rareModCount(rng)): Item {
  let out: Item = { ...keepLocked(item), rarity: 'rare' }
  if (guarantee) out = addRandomMod(out, rng, { ...o, weight: (id) => (guarantee(id) ? (o.weight?.(id) ?? 1) : 0) }) ?? out
  while (out.explicits.length < total) {
    const next = addRandomMod(out, rng, o)
    if (!next) break
    out = next
  }
  return out
}
const canGuarantee = (item: Item, guarantee: (id: string) => boolean) => modPool(keepLocked(item)).some(guarantee)

// ---- Reforge a Rare item with random modifiers, including a [Tag] modifier
export const REFORGE_TAGS: [tag: string, cost: Cost][] = [
  ['fire', { wild: 50 }], ['cold', { vivid: 50 }], ['lightning', { primal: 50 }], ['physical', { vivid: 50 }],
  ['life', { wild: 75 }], ['defences', { primal: 75 }], ['chaos', { vivid: 100 }], ['attack', { wild: 75 }],
  ['caster', { primal: 75 }], ['speed', { vivid: 150 }], ['critical', { primal: 150 }], ['minion', { primal: 200, rancour: 3 }],
  ['elemental', { wild: 200, rancour: 1 }], ['attribute', { vivid: 200, rancour: 2 }], ['mana', { primal: 200, rancour: 2 }],
  ['drop', { vivid: 200, rancour: 1 }],
]
// Tag -> word in the game's craft ids ("ReforgeSpell" is the Caster one).
const DAT_TAG: Record<string, string> = {
  fire: 'Fire', cold: 'Cold', lightning: 'Lightning', physical: 'Physical', life: 'Life', defences: 'Defences', chaos: 'Chaos',
  attack: 'Attack', caster: 'Spell', speed: 'Speed', critical: 'Critical', minion: 'Minion', elemental: 'Elemental',
  attribute: 'Attribute', mana: 'Mana', drop: 'Drop',
}
const reforgeTag = ([tag, cost]: [string, Cost]): HarvestCraft => ({
  id: `Reforge${DAT_TAG[tag]}`, cost,
  can: (i) => editable(i) && i.rarity === 'rare' && canGuarantee(i, hasTag(tag)),
  apply: (i, rng) => reforge(i, rng, hasTag(tag)),
})

// ---- Reforge a Rare item, being more / less likely to receive the same modifier types
// Craft of Exile FAQ (datamined in Harvest league): mods already on the item weigh x90, and the item never ends up with
// fewer mods than it had. ponytail: "less likely" mirrored as /90 with a normal mod count; no published numbers.
export const SAME_TYPES = 90
const likely = (more: boolean): HarvestCraft => ({
  id: more ? 'ReforgeMoreLikely' : 'ReforgeLessLikely', cost: { wild: 200 },
  can: (i) => editable(i) && i.rarity === 'rare',
  apply: (i, rng) => {
    const groups = new Set(i.explicits.flatMap((m) => MODS[m.id].grp))
    const same = (id: string) => MODS[id].grp.some((g) => groups.has(g))
    const weight = (id: string) => (same(id) ? (more ? SAME_TYPES : 1 / SAME_TYPES) : 1)
    const total = rareModCount(rng)
    return reforge(i, rng, undefined, { weight }, more ? Math.max(total, i.explicits.length) : total)
  },
})

// ---- Change a [Fire/Cold/Lightning] resistance or damage modifier into a similar-tier one of another element.
// A mod family qualifies when swapping the element word in its name gives a family that can roll on the item
// ("ColdDamagePercentage" -> "FireDamagePercentage"). The new mod takes the same tier (or the closest it has).
const ELEMENTS = ['Fire', 'Cold', 'Lightning']
function familyByTier(item: Item, type: string, gen: string): string[] {
  const tags = itemTags({ ...item, explicits: [] })
  return Object.keys(MODS).filter((id) => MODS[id].type === type && MODS[id].gen === gen && !MODS[id].dom && spawnWeight(id, tags) > 0)
    .sort((a, b) => MODS[b].lvl - MODS[a].lvl)
}
function swapTarget(item: Item, id: string, from: string, to: string): string | undefined {
  const m = MODS[id]
  if (!m.type.includes(from)) return undefined
  const mine = familyByTier(item, m.type, m.gen)
  const theirs = familyByTier(item, m.type.split(from).join(to), m.gen)
  if (!theirs.length || mine.indexOf(id) < 0) return undefined
  return theirs[Math.min(mine.indexOf(id), theirs.length - 1)]
}
const swap = (kind: 'res' | 'dmg', from: string, to: string, cost: Cost): HarvestCraft => {
  const fits = (id: string) => kind === 'res'
    ? (MODS[id].tags ?? []).includes('resistance')
    : (MODS[id].tags ?? []).includes('damage') && !(MODS[id].tags ?? []).includes('resistance')
  // The new mod can't share a mod group with another mod on the item (no second cold resistance mod, user-reported).
  const clashes = (i: Item, m: RolledMod, id: string) =>
    i.explicits.some((x) => x !== m && MODS[x.id].grp.some((g) => MODS[id].grp.includes(g)))
  const targets = (i: Item) => i.explicits.filter((m) => {
    if (!changeable(i, m) || m.crafted || !fits(m.id)) return false
    const id = swapTarget(i, m.id, from, to)
    return !!id && !clashes(i, m, id)
  })
  return {
    id: `Change${from}To${to}${kind === 'res' ? 'Resist' : 'Damage'}`, cost,
    can: (i) => editable(i) && (i.rarity === 'magic' || i.rarity === 'rare') && targets(i).length > 0,
    apply: (i, rng) => {
      const old = pick(rng, targets(i))
      return { ...i, explicits: i.explicits.map((m) => (m === old ? rollMod(swapTarget(i, m.id, from, to)!, rng) : m)) }
    },
  }
}
// Paid in the target element's colour: Fire = Wild, Cold = Vivid, Lightning = Primal.
const COLOUR: Record<string, Lifeforce> = { Fire: 'wild', Cold: 'vivid', Lightning: 'primal' }
const SWAPS = ELEMENTS.flatMap((to) => ELEMENTS.filter((f) => f !== to).flatMap((from) => [
  swap('res', from, to, { [COLOUR[to]]: 500 }),
  swap('dmg', from, to, { [COLOUR[to]]: 500, rancour: 1 }),
]))

// ---- Randomise the Influence types on an Influenced Normal, Magic or Rare Item, reforging it with new random modifiers.
// ponytail: keeps the number of influences; meta-crafts ignored like the Awakener's Orb (the wiki's table doesn't list it).
const randomiseInfluence: HarvestCraft = {
  id: 'RerollInfluenceType', cost: { primal: 1000 },
  can: (i) => editable(i) && i.influences.length > 0,
  apply: (i, rng) => {
    const pool = [...INFLUENCES]
    const chosen: Influence[] = []
    while (chosen.length < i.influences.length) chosen.push(pool.splice(int(rng, 0, pool.length - 1), 1)[0])
    const influences = INFLUENCES.filter((x) => chosen.includes(x))
    let out: Item = { ...i, influences, explicits: [] }
    const n = i.rarity === 'rare' ? rareModCount(rng) : i.rarity === 'magic' ? magicModCount(rng) : 0
    for (let k = 0; k < n; k++) out = addRandomMod(out, rng) ?? out
    return out
  },
}

// ---- Reforge an Influenced Rare item with random modifiers, including an Influence modifier
const isItemInfluence = (i: Item) => (id: string) => { const inf = modInfluence(id); return !!inf && i.influences.includes(inf) }
const reforgeInfluence: HarvestCraft = {
  id: 'BossInfluence1', cost: { primal: 5000, sacred: 1 },
  can: (i) => editable(i) && i.rarity === 'rare' && i.influences.length > 0 && canGuarantee(i, isItemInfluence(i)),
  apply: (i, rng) => reforge(i, rng, isItemInfluence(i)),
}

// ---- Add a new [Tag] modifier and remove another random modifier from a non-Influenced item
// The removal honours Prefixes/Suffixes Cannot Be Changed (and never takes fractured mods); the added mod honours
// "Cannot roll Attack/Caster Modifiers". Removal happens first, so it works on full items.
export const AUGMENT_TAGS: [tag: string, cost: Cost][] = [
  ['fire', { wild: 15000, sacred: 1 }], ['cold', { vivid: 15000, sacred: 1 }], ['lightning', { primal: 15000, sacred: 1 }],
  ['physical', { vivid: 15000, sacred: 1 }], ['life', { wild: 17500, sacred: 1 }], ['defences', { primal: 17500, sacred: 1 }],
  ['chaos', { vivid: 17500, sacred: 1 }], ['attack', { wild: 17500, sacred: 1 }], ['caster', { primal: 17500, sacred: 1 }],
  ['speed', { vivid: 20000, sacred: 1 }], ['critical', { primal: 20000, sacred: 1 }],
]
const without = (i: Item, gone: Item['explicits'][number]): Item => ({ ...i, explicits: i.explicits.filter((m) => m !== gone) })
const augment = ([tag, cost]: [string, Cost]): HarvestCraft => {
  const removable = (i: Item) => i.explicits.filter((m) => changeable(i, m) && modPool(without(i, m)).some(hasTag(tag)))
  return {
    id: `Augment${DAT_TAG[tag]}`, cost,
    can: (i) => editable(i) && (i.rarity === 'magic' || i.rarity === 'rare') && !i.influences.length && removable(i).length > 0,
    apply: (i, rng) => {
      const rest = without(i, pick(rng, removable(i)))
      return addRandomMod(rest, rng, only(hasTag(tag))) ?? rest
    },
  }
}

export const HARVEST: HarvestCraft[] = [
  ...REFORGE_TAGS.map(reforgeTag), likely(true), likely(false), ...SWAPS, randomiseInfluence, reforgeInfluence,
  ...AUGMENT_TAGS.map(augment),
]
export const harvestCraft = (id: string) => HARVEST.find((c) => c.id === id)!
