// Beastcrafting (Blood Altar) recipes that craft equipment, as listed for 3.29 on PoE Wiki "Beastcrafting" (cross-checked
// with Craft of Exile's beast crafting methods); rules from the wiki and its Metamod table. Recipes that make items,
// currency, maps or gems, or touch sockets/links/talismans, aren't part of this game.
// The Wild Bristle Matron (random meta-craft) lives in crafting.ts. A recipe costs its named beasts; the filler
// "any rare beast" slots are cheap and left out.
import { craftedCount } from './crafting.ts'
import { MODS, type Influence } from './data.ts'
import { influenceOnly } from './influence.ts'
import { addRandomMod, affixCounts, affixLimits, changeable, editable, isPrefix, metamods, modPool, rollMod, type Item } from './item.ts'
import { int, type Rng } from './rng.ts'

export interface BeastRecipe {
  id: string // the game's BestiaryRecipes id: its text (en/ko) comes from game data
  beasts: string[] // English names (poe.ninja / game data), priced and translated from data
  can: (item: Item) => boolean
  apply: (item: Item, rng: Rng) => Item
}

const pick = <T>(rng: Rng, xs: T[]) => xs[int(rng, 0, xs.length - 1)]
const room = (i: Item, prefix: boolean) => {
  const c = affixCounts(i)
  const l = affixLimits(i)
  return prefix ? c.prefix < l.prefix : c.suffix < l.suffix
}

// ---- Add a Prefix, Remove a Random Suffix (Farric Wolf Alpha) / Add a Suffix, Remove a Random Prefix (Farric Lynx
// Alpha). Rare items only. The new mod's level comes from the beast, not the item. Metamod table: a locked removing
// side means it adds without removing; "Cannot roll Attack/Caster Modifiers" doesn't protect.
// ponytail: beasts bought on the market come from tier 16 maps, so the beast level is taken as 83.
export const BEAST_LEVEL = 83
function addRemove(addPrefix: boolean): BeastRecipe {
  const side = (id: string) => (MODS[id].gen === 'prefix') === addPrefix
  const asBeast = (i: Item): Item => ({ ...i, ilvl: BEAST_LEVEL })
  return {
    id: addPrefix ? 'EinharMasterCraft31' : 'EinharMasterCraft30',
    beasts: [addPrefix ? 'Farric Wolf Alpha' : 'Farric Lynx Alpha'],
    can: (i) => editable(i) && i.rarity === 'rare' && room(i, addPrefix) && modPool(asBeast(i), [], Infinity, true).some(side),
    apply: (i, rng) => {
      const added = addRandomMod(asBeast(i), rng, { weight: (id) => (side(id) ? 1 : 0), ignoreMeta: true }) ?? asBeast(i)
      const removable = i.explicits.filter((m) => isPrefix(m) !== addPrefix && changeable(i, m))
      const gone = removable.length ? pick(rng, removable) : undefined
      return { ...added, ilvl: i.ilvl, explicits: added.explicits.filter((m) => m !== gone) }
    },
  }
}

// ---- Add a Mod to a [Shaper/Elder/Conqueror] Item: the item's influence gets one more of its mods (+ Craicic Maw).
// ponytail: magic or rare with room, item level as usual (the wiki says only "other recipes use the item level").
const INFLUENCE_BEASTS: Record<Influence, [recipe: string, beast: string]> = {
  shaper: ['EinharMasterCraft42', 'Fenumal Devourer'], elder: ['EinharMasterCraft43', 'Saqawine Blood Viper'],
  redeemer: ['EinharMasterCraft44', 'Fenumal Queen'], hunter: ['EinharMasterCraft45', 'Craicic Watcher'],
  crusader: ['EinharMasterCraft46', 'Farric Goliath'], warlord: ['EinharMasterCraft47', 'Fenumal Scrabbler'],
}
const addInfluenceMod = (inf: Influence): BeastRecipe => ({
  id: INFLUENCE_BEASTS[inf][0], beasts: [INFLUENCE_BEASTS[inf][1], 'Craicic Maw'],
  can: (i) => editable(i) && (i.rarity === 'magic' || i.rarity === 'rare') && i.influences.includes(inf)
    && modPool(i).some((id) => influenceOnly(i, inf)(id) > 0),
  apply: (i, rng) => addRandomMod(i, rng, { weight: influenceOnly(i, inf) }) ?? i,
})

// ---- Craft an Aspect Skill onto an Item: a crafted "of Farrul"-style suffix granting the level 20 Aspect skill.
// Counts as the item's crafted mod (one per item unless "Can have up to 3 Crafted Modifiers").
// Left out: the level 30 versions (need the Black Mórrigan, whose recipes are about sockets/links, not in this game).
const ASPECTS: [recipe: string, beast: string, mod: string][] = [
  ['EinharMasterCraft38', 'Farrul, First of the Plains', 'GrantsCatAspectCrafted'],
  ['EinharMasterCraft39', 'Saqawal, First of the Sky', 'GrantsBirdAspectCrafted'],
  ['EinharMasterCraft40', 'Fenumus, First of the Night', 'GrantsSpiderAspectCrafted'],
  ['EinharMasterCraft41', 'Craiceann, First of the Deep', 'GrantsCrabAspectCrafted'],
]
const aspect = ([recipe, beast, id]: (typeof ASPECTS)[number]): BeastRecipe => {
  return {
    id: recipe, beasts: [beast],
    can: (i) => editable(i) && (i.rarity === 'magic' || i.rarity === 'rare') && room(i, false)
      && craftedCount(i) < (metamods(i).multiCraft ? 3 : 1)
      && !i.explicits.some((m) => MODS[m.id].grp.some((g) => MODS[id].grp.includes(g))),
    apply: (i, rng) => ({ ...i, explicits: [...i.explicits, { ...rollMod(id, rng), crafted: true }] }),
  }
}

export const BEAST_RECIPES: BeastRecipe[] = [
  addRemove(true), addRemove(false),
  ...(['shaper', 'elder', 'crusader', 'redeemer', 'hunter', 'warlord'] as Influence[]).map(addInfluenceMod),
  ...ASPECTS.map(aspect),
]
export const beastRecipe = (id: string) => BEAST_RECIPES.find((r) => r.id === id)!

// ---- Imprint (Craicic Croaker): snapshot a magic item; the Imprint later restores everything about it (implicits,
// explicits, quality), e.g. to undo a bad Regal Orb or an Awakener's Orb on it. PoE Wiki "Imprint": never on
// corrupted, mirrored or fractured items, and an imprint can't be used once the item got fractured. Items made from
// others (recombinator) are new items without the imprint. The imprint rides along on the item.
export const IMPRINT_BEAST = 'Craicic Croaker'
export const IMPRINT_RECIPE = 'EinharMasterCraft27' // "Create an Imprint: Of a Magic Item"
export const IMPRINT = 'Imprint'
const fractured = (i: Item) => i.explicits.some((m) => m.fractured)
export const canImprint = (i: Item) => editable(i) && i.rarity === 'magic' && !fractured(i)
export const imprint = (i: Item): Item => {
  const { imprint: _old, ...snapshot } = i
  return { ...i, imprint: snapshot }
}
export const canRestore = (i: Item) => editable(i) && !!i.imprint && !fractured(i)
export const restore = (i: Item): Item => ({ ...i.imprint! })
