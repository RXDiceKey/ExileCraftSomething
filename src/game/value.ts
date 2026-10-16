// Faustus's quote. An item is worth what the best-fitting buyer pays — not the sum of its options —
// so high-tier options spread across different builds are cheap and options concentrated on one build are pricey.
// Buyers: the 30 popular builds (src/data/builds.json, slot by slot) plus a few generic "+@" demands.
import { BASES, MODS } from '../engine/data.ts'
import { eldritchTier, EMBERS } from '../engine/eldritch.ts'
import { isInfluenced, modInfluence } from '../engine/influence.ts'
import { affixLimits, fractured, itemTags, onBase, rollMod, spawnWeight, type Item } from '../engine/item.ts'
import { baseKindKeys, effectPct, modName, tierOf, type Lang } from './describe.ts'
import { boom, BUILDS, popularity, saturation, trend, type Meta, type Slot } from './meta.ts'
import { expectedCost } from './history.ts'
import { replay } from './replay.ts'
import { basePrice, baseResale, GOLD_PER_CHAOS, MIRROR, priceOf } from './shop.ts'

interface Profile {
  id: string
  name: Record<Lang, string>
  budget: number // chaos for 6 useful tier-1 options on a fitting base
  fit: (cls: string, tags: string[]) => number // 0..1, does this buyer use this base?
  wants: Record<string, number> // stat id -> weight 0..1
}

const ARMOUR = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield']
const JEWELLERY = ['Ring', 'Amulet', 'Belt']
const ES_TAGS = ['int_armour', 'str_int_armour', 'dex_int_armour']
const ATTACK_WEAPONS = ['Claw', 'Dagger', 'One Hand Axe', 'One Hand Sword', 'Thrusting One Hand Sword', 'One Hand Mace',
  'Bow', 'Warstaff', 'Two Hand Axe', 'Two Hand Sword', 'Two Hand Mace']
const RES = {
  base_fire_damage_resistance_: 0.8, base_cold_damage_resistance_: 0.8, base_lightning_damage_resistance_: 0.8,
  base_chaos_damage_resistance_: 0.7,
}
const resists = (w = 1) => Object.fromEntries(Object.entries(RES).map(([k, v]) => [`${k}%`, v * w]))

export const PROFILES: Profile[] = [
  {
    id: 'life_res',
    name: { ko: '생명력·저항 빌드', en: 'Life & resist builds' },
    budget: 300,
    fit: (cls, tags) => ARMOUR.includes(cls) ? (tags.includes('int_armour') ? 0.6 : 1) : JEWELLERY.includes(cls) || cls === 'Quiver' ? 1 : 0,
    wants: { base_maximum_life: 1, 'maximum_life_+%': 1, ...resists() },
  },
  {
    id: 'es_res',
    name: { ko: '에너지 보호막 빌드', en: 'Energy shield builds' },
    budget: 500,
    fit: (cls, tags) => ARMOUR.includes(cls) ? (tags.some((t) => ES_TAGS.includes(t)) ? 1 : 0.15) : JEWELLERY.includes(cls) ? 1 : 0,
    wants: {
      local_energy_shield: 1, 'local_energy_shield_+%': 1, 'local_armour_and_energy_shield_+%': 0.6,
      'local_evasion_and_energy_shield_+%': 0.6, 'local_armour_and_evasion_and_energy_shield_+%': 0.5,
      base_maximum_energy_shield: 1, 'maximum_energy_shield_+%': 1, 'energy_shield_recharge_rate_+%': 0.4, ...resists(),
    },
  },
  {
    id: 'ms_boots',
    name: { ko: '이동 속도 신발 수요', en: 'Movement speed boots' },
    budget: 400,
    fit: (cls) => (cls === 'Boots' ? 1 : 0),
    wants: { 'base_movement_velocity_+%': 1, base_maximum_life: 0.8, local_energy_shield: 0.6, ...resists(0.75) },
  },
  {
    id: 'phys_weapon',
    name: { ko: '물리 공격 빌드', en: 'Physical attack builds' },
    budget: 1500,
    fit: (cls) => (ATTACK_WEAPONS.includes(cls) ? 1 : cls === 'Sceptre' ? 0.5 : 0),
    wants: {
      'local_physical_damage_+%': 1, local_minimum_added_physical_damage: 1, local_maximum_added_physical_damage: 1,
      'local_attack_speed_+%': 1, 'local_critical_strike_chance_+%': 0.7, 'base_critical_strike_multiplier_+': 0.7,
    },
  },
  {
    id: 'spell_weapon',
    name: { ko: '주문 빌드', en: 'Spell builds' },
    budget: 1000,
    fit: (cls, tags) => (['Wand', 'Sceptre', 'Staff', 'Rune Dagger'].includes(cls) || tags.includes('focus') ? 1 : cls === 'Dagger' ? 0.6 : 0),
    wants: {
      'spell_damage_+%': 1, 'spell_skill_gem_level_+': 1, 'fire_spell_skill_gem_level_+': 1, 'cold_spell_skill_gem_level_+': 1,
      'lightning_spell_skill_gem_level_+': 1, 'chaos_spell_skill_gem_level_+': 1, 'physical_spell_skill_gem_level_+': 1,
      'base_cast_speed_+%': 1, 'spell_critical_strike_chance_+%': 0.7, 'base_critical_strike_multiplier_+': 0.7,
    },
  },
]

// Chaos a build pays for an item with PRICE_ANCHOR (5) tier-1 options it wants, on a fitting base, before popularity.
const SLOT_BUDGET: Record<Slot, number> = {
  weapon: 1200, offhand: 400, helmet: 400, body: 600, gloves: 400, boots: 400, ring: 350, amulet: 450, belt: 350,
}
const SLOT_OF: Record<string, Slot> = {
  Shield: 'offhand', Quiver: 'offhand', Helmet: 'helmet', 'Body Armour': 'body', Gloves: 'gloves', Boots: 'boots',
  Ring: 'ring', Amulet: 'amulet', Belt: 'belt',
}
export const slotOf = (cls: string): Slot => SLOT_OF[cls] ?? 'weapon'

const TIER_QUALITY = [1, 0.8, 0.6, 0.45, 0.3]
const ELEVATED_QUALITY = 1.25 // tier 0: elevated mods beat tier 1
const tierQualityOf = (tier: number) => (tier === 0 ? ELEVATED_QUALITY : TIER_QUALITY[tier - 1] ?? 0.15)
const USEFUL_MIN = 0.25 // shown as "useful" in Faustus's explanation
const FLOOR = GOLD_PER_CHAOS // junk still fetches a chaos

// Concentration is what makes items expensive. Each wanted option adds its contribution (0..1, ~1 for a tier-1 roll)
// to a total S, and the price grows exponentially in S: every extra good option multiplies the price by e^1.4 (~4x).
// So tiers 1,2,2 beat 1,1 plus junk, and a 6-option item on one build is worth vastly more than two 3-option items.
// P7 sim: random rares sit at S 1-2 and a strong targeted craft around 3-4, so the slot budget is anchored at S = 5
// (S 2 ~ a few chaos, 3 ~ 20c, 4 ~ 100c, 5 ~ budget, 6 ~ 4x budget). FULL_ITEM (6 options) is only for "completeness".
export const SYNERGY = 1.4
export const PRICE_ANCHOR = 5
// Overall price level on top of every budget (user, 2026-10-15: three tier 1-2 options on a Twilight Regalia sold for
// about 3,000 gold, "at least 2 divine"). x25: one good option ~ a chaos, three ~ 2.5 divine, six on one build ~ 160.
export const PRICE_LEVEL = 25
export const FULL_ITEM = 6
export const synergy = (contributions: number[]) => Math.exp(SYNERGY * (contributions.reduce((a, b) => a + b, 0) - PRICE_ANCHOR))

// ---- Base quality: tier 1 options on a weak base can't beat tier 2 options on a top base.
// Armour: base defence vs the best base of the same class and defence type. Weapons: base physical DPS vs the best
// of the class for attack buyers, base level for caster buyers. Jewellery/quivers: 1 (their implicits count instead).
const DEFENCES = ['armour', 'evasion', 'energy_shield', 'ward']
const ARMOUR_CLASSES = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield']
const range = (v: unknown) => (typeof v === 'object' && v !== null ? (v as { max: number }).max : 0)
const defenceOf = (id: string) => DEFENCES.reduce((sum, k) => sum + range(BASES[id].props[k]), 0)
const dpsOf = (id: string) => {
  const p = BASES[id].props as Record<string, number>
  return p.physical_damage_max ? ((p.physical_damage_min + p.physical_damage_max) / 2) * (1000 / p.attack_time) : 0
}
const bestCache = new Map<string, number>()
const best = (key: string, ids: () => string[], score: (id: string) => number) => {
  if (!bestCache.has(key)) bestCache.set(key, Math.max(1e-9, ...ids().map(score)))
  return bestCache.get(key)!
}
const ATTACK_STATS = ['local_physical_damage_+%', 'local_minimum_added_physical_damage', 'local_attack_speed_+%',
  'local_critical_strike_chance_+%', 'local_minimum_added_fire_damage', 'local_minimum_added_cold_damage',
  'local_minimum_added_lightning_damage']
export function baseQuality(base: string, attackBuyer: boolean): number {
  const b = BASES[base]
  if (ARMOUR_CLASSES.includes(b.cls)) {
    const kind = baseKindKeys(base).defences.join('/')
    const peers = () => Object.keys(BASES).filter((id) => BASES[id].cls === b.cls && baseKindKeys(id).defences.join('/') === kind)
    return defenceOf(base) / best(`def|${b.cls}|${kind}`, peers, defenceOf)
  }
  if (slotOf(b.cls) !== 'weapon') return 1
  const peers = () => Object.keys(BASES).filter((id) => BASES[id].cls === b.cls)
  return attackBuyer
    ? dpsOf(base) / best(`dps|${b.cls}`, peers, dpsOf)
    : Math.max(1, b.lvl) / best(`lvl|${b.cls}`, peers, (id) => Math.max(1, BASES[id].lvl))
}
// Not all options are equal. Resistances and attributes are easy to fill from other slots; block and spell suppression
// have to be capped and few slots give them; gem levels are what every caster fights over.
// ponytail: hand-picked stat lists from user feedback; extend when another "everyone fights over this" option turns up.
const ALL_GEMS = 'all_skill_gem_level_+'
const GLOBAL_GEMS = /^(?!local_).*skill_gem_level_\+$/ // "+1 to Level of all Cold Skill Gems" etc.
const PRIORITY: [RegExp, number, ModNote][] = [
  [/^all_skill_gem_level_\+$/, 2, 'premium'],
  [/skill_gem_level_\+$|^local_socketed_.*gem_level_\+$/, 1.5, 'priority'],
  [/^(local_block_chance_\+%|additional_block_%|base_spell_block_%|additional_spell_block_%|maximum_block_%|base_maximum_spell_block_%)$/, 1.5, 'priority'],
  [/^base_spell_suppression_chance_%$|^base_spell_damage_%_suppressed$/, 1.3, 'priority'],
  [/^base_chaos_damage_resistance_%$/, 0.7, 'common'],
  [/^base_(fire|cold|lightning)_damage_resistance_%$|^base_resist_all_elements_%$|^(fire|cold)_and_(cold|lightning)_damage_resistance_%$/, 0.5, 'common'],
  [/^additional_(strength|dexterity|intelligence|all_attributes)(_and_(dexterity|intelligence))?$/, 0.5, 'common'],
]
const priorityOf = (sid: string) => PRIORITY.find(([re]) => re.test(sid))

// Attribute stackers live on that attribute: it's a priority option for them and only high rolls count. A stacker wants
// "% increased <attribute>" somewhere (nobody else does) and the flat attribute on 3+ slots, e.g. int-stacking Kinetic
// Blast. Builds stacking several attributes (Omniscience style) get this for each, so several high rolls on one item
// stack up through concentration.
const ATTRS = ['strength', 'dexterity', 'intelligence']
function attrsOf(sid: string): string[] {
  const m = /^additional_(strength|dexterity|intelligence|all_attributes)(?:_and_(dexterity|intelligence))?$/.exec(sid)
    ?? /^(strength|dexterity|intelligence|all_attributes)_\+%$/.exec(sid)
  return !m ? [] : m[1] === 'all_attributes' ? ATTRS : [m[1], m[2]].filter((a): a is string => !!a)
}
const STACK_SLOTS = 3
const STACKER = 1.5
const PCT_ATTR = /^(strength|dexterity|intelligence|all_attributes)_\+%$/
function stackedOf(b: (typeof BUILDS)[number]): Set<string> {
  const slots = Object.values(b.slots).map((s) => Object.keys(s?.wants ?? {}))
  const pct = new Set(slots.flat().filter((sid) => PCT_ATTR.test(sid)).flatMap(attrsOf))
  const flatSlots = (a: string) => slots.filter((ids) => ids.some((sid) => !PCT_ATTR.test(sid) && attrsOf(sid).includes(a))).length
  return new Set(ATTRS.filter((a) => pct.has(a) && flatSlots(a) >= STACK_SLOTS))
}
const STACKS = new Map(BUILDS.map((b) => [b.id, stackedOf(b)]))
export const stackedAttributes = (buildId: string) => [...(STACKS.get(buildId) ?? [])]

// How much a buyer wants a mod: its best stat. A hybrid mod (two stats, e.g. minimum frenzy charges + frenzy charge on
// kill) is still one option, so it never counts twice. `steep`: only high tiers count (stacked attributes).
function wantOf(p: Pick<Buyer, 'wants' | 'stacks'>, stats: string[]): { w: number; note?: ModNote; steep: boolean } {
  let best: { w: number; note?: ModNote; steep: boolean } = { w: 0, steep: false }
  for (const sid of stats) {
    let want = p.wants[sid] ?? 0
    // +all skill gems does whatever "+all <element> skill gems" does, for every build: same value, wider market.
    if (sid === ALL_GEMS) want = Math.max(want, ...Object.keys(p.wants).filter((s) => GLOBAL_GEMS.test(s)).map((s) => p.wants[s]))
    const stack = attrsOf(sid).some((a) => p.stacks.has(a))
    const pr = priorityOf(sid)
    const w = want * (stack ? STACKER : (pr?.[1] ?? 1))
    if (w > best.w) best = { w, note: stack ? 'stacked' : pr?.[2], steep: stack }
  }
  return best
}
// Some options only work as a package: Righteous Fire's helmet needs several "Socketed Gems are Supported by" options
// together, one alone is nearly worthless. Every socketed-gem option a buyer wants in a slot forms the set.
const SET_STAT = /^local_display_socketed_/
// Full price from FULL_FROM useful options on; each one short x SHORT (user, 2026-10-15). One or two good options are an
// alteration + regal + exalt away (a Coral Ring with tier 1-3 life and two exalts sold at ~15x its cost after the x25
// price level), three good ones are a real result. None at all: no option value, only the base.
export const FULL_FROM = 3
export const SHORT = 0.1
export const shortfall = (useful: number) => (useful === 0 ? 0 : useful >= FULL_FROM ? 1 : SHORT ** (FULL_FROM - useful))

const BASE_POWER = 1.5
const IMPLICIT_WEIGHT = 0.1 // fixed options barely count (user: a slot the base's implicit fills isn't a crafted option)

// Advanced / uber builds only count high tiers but pay much more for a near-complete item.
const BUILD_TIER: Record<string, { maxTier: number; budget: number }> = {
  starter: { maxTier: 99, budget: 1 },
  advanced: { maxTier: 3, budget: 3 },
  uber: { maxTier: 2, budget: 10 },
}

interface Buyer {
  id: string
  name: string
  budget: number
  fit: number // 0..1: does this buyer use this kind of base?
  wants: Record<string, number>
  pop: number // popularity multiplier
  sat: number // saturation alone (part of pop): copies of a mirror-tier item flood its buyers too
  maxTier: number // options worse than this tier don't count for this buyer
  build: boolean
  stacks: Set<string> // attributes this build stacks
}

export type ModNote = 'premium' | 'priority' | 'common' | 'stacked' | 'incompleteSet'
export interface ModVerdict { id: string; name: string; tier: number; contribution: number; useful: boolean; note?: ModNote }
export interface ProfileQuote { id: string; name: string; value: number; trend: 'rising' | 'falling' | null }
export interface Quote {
  boom: number // weekend boom multiplier on buyer values (1 = none)
  price: number // max(option value, (expected cost + option value) / 2), never below the floors
  optionValue: number // what the best buyer pays for the options (V)
  expectedCost: number // what making it is expected to cost (E, see history.ts)
  top: ProfileQuote[] // best 3 buyers that pay anything
  best?: {
    id: string; name: string; fit: number; usefulCount: number; completeness: number; baseQuality: number; mods: ModVerdict[]
    mirror: boolean // mirror tier (D46): priced as a copy, a mirror plus the fee
    capped: boolean // short of mirror tier and bent below MIRROR_CAP of a mirror
  }
  baseResale: number
}

function buyers(item: Item, lang: Lang, day: number, meta?: Meta): Buyer[] {
  const base = BASES[item.base]
  const slot = slotOf(base.cls)
  const defences = baseKindKeys(item.base).defences
  const generic = PROFILES.map((p): Buyer => ({
    id: p.id, name: p.name[lang], budget: p.budget, fit: p.fit(base.cls, base.tags), wants: p.wants, pop: saturation(meta, p.id, slot), sat: saturation(meta, p.id, slot), maxTier: 99, build: false,
    stacks: new Set(),
  }))
  const builds = BUILDS.flatMap((b): Buyer[] => {
    const want = b.slots[slot]
    if (!want) return [] // this build wears a unique there, or doesn't use the slot
    let fit = 1
    if (want.classes && !want.classes.includes(base.cls)) fit = 0.3
    else if (want.defence && !want.defence.some((d) => defences.includes(d))) fit = 0.4
    const t = BUILD_TIER[b.tier]
    return [{
      id: b.id, name: b.name[lang], budget: SLOT_BUDGET[slot] * t.budget, fit, wants: want.wants,
      pop: popularity(meta, b.id, day) * saturation(meta, b.id, slot), sat: saturation(meta, b.id, slot), maxTier: t.maxTier, build: true,
      stacks: STACKS.get(b.id)!,
    }]
  })
  return [...builds, ...generic]
}

// ---- Drop-only options (D42): Breachlord, Delve and Incursion options are top tier by nature and can't be crafted, so a
// buyer who wants one pays DROP_PREMIUM more. Options no build profile lists (they never show up in crafted gear) go to
// the builds of their theme: minion options to minion builds, mine/trap options to mine/trap builds, aura options to aura
// builds; "+1 to maximum number of Spectres" only to the spectre build.
export const DROP_PREMIUM = 1.5
const THEME_WANT = 0.8
const THEMES: [has: RegExp, gives: RegExp][] = [[/minion/, /minion/], [/mine/, /mine/], [/trap/, /trap/], [/aura/, /aura|envy/]] // Envy is an aura
const BUILD_STATS = new Map(BUILDS.map((b) => [b.id, Object.values(b.slots).flatMap((s) => Object.keys(s?.wants ?? {}))]))
function dropThemeWant(p: Buyer, stats: string[]): number {
  if (!p.build) return 0
  if (stats.includes('base_number_of_spectres_allowed')) return /spectre/.test(p.id) ? 1 : 0
  const own = BUILD_STATS.get(p.id) ?? []
  return THEMES.some(([has, gives]) => own.some((s) => has.test(s)) && stats.some((s) => gives.test(s))) ? THEME_WANT : 0
}

// ---- Rarity (user): an option that comes up less often than a standard one of its tier is worth more, and one that
// comes up more often less, from the spawn weights. Most tiers here weigh 1000, so a standard option at tier t has
// t x 1000 of weight at that tier or better; all-attributes tiers weigh 400, a tier-1 attack speed 500, influence
// options less. Damped hard, a 10x rarer option is not 10x the price: 1 + RARITY_K x ln(ratio) within
// [RARITY_MIN, RARITY_MAX] per option, and the item takes the geometric mean over its useful options.
// Elevated options count as the tier-1 option they were raised from (user). Drop-only options (user: they need it too,
// on top of DROP_PREMIUM) count how rare they are among their source's drops: Breachlord ones by their weights, Delve /
// Incursion ones as one of the n this base can come with.
export const RARITY_K = 0.3
export const RARITY_MIN = 0.7
export const RARITY_MAX = 2
const STANDARD_WEIGHT = 1000
const rarityCache = new Map<string, number>()
export function rarityOf(item: Item, modId: string): number {
  const m = MODS[modId]
  if (m.dom || m.essenceOnly) return 1 // crafted or guaranteed: no roll to be rare in
  const key = `${item.base}|${item.influences.join()}|${modId}`
  let r = rarityCache.get(key)
  if (r === undefined) {
    const damp = (ratio: number) => Math.min(RARITY_MAX, Math.max(RARITY_MIN, 1 + RARITY_K * Math.log(ratio)))
    const tags = itemTags({ ...item, explicits: [] })
    const inf = modInfluence(modId)
    if (m.drop === 'breach') {
      const total = Object.keys(MODS).reduce((s, id) => s + (MODS[id].drop === 'breach' ? MODS[id].dw ?? 0 : 0), 0)
      r = m.dw ? damp(total / m.dw) : 1
    } else if (m.drop) {
      r = damp(Math.max(1, Object.keys(MODS).filter((id) => MODS[id].drop === m.drop && onBase(item.base, MODS[id].on ?? [])).length))
    } else if (m.elev) {
      const from = Object.keys(MODS).filter((id) => MODS[id].type === m.elev && MODS[id].gen === m.gen && !MODS[id].elev
        && modInfluence(id) === inf && spawnWeight(id, tags) > 0).sort((a, b) => MODS[b].lvl - MODS[a].lvl)[0]
      r = from ? rarityOf(item, from) : 1
    } else {
      const weight = Object.keys(MODS).filter((id) => MODS[id].type === m.type && MODS[id].gen === m.gen && MODS[id].lvl >= m.lvl
        && modInfluence(id) === inf).reduce((s, id) => s + spawnWeight(id, tags), 0)
      r = weight > 0 ? damp(tierOf(item, modId) * STANDARD_WEIGHT / weight) : 1
    }
    rarityCache.set(key, r)
  }
  return r
}

function judge(item: Item, p: Buyer, lang: Lang) {
  const mods = item.explicits.map((m): ModVerdict => {
    const def = MODS[m.id]
    // A drop option's zero stats (the other minion counts) say nothing about what it does.
    const stats = (def.drop ? def.stats.filter(([, a, b]) => a || b) : def.stats).map(([sid]) => sid)
    const natural = wantOf(p, stats)
    const { w, note, steep } = def.drop ? { ...natural, w: Math.max(natural.w, dropThemeWant(p, stats)) } : natural
    const tier = tierOf(item, m.id)
    const roll = def.stats.length
      ? def.stats.reduce((s, [, a, b], i) => s + (a === b ? 1 : (m.values[i] - Math.min(a, b)) / Math.abs(b - a)), 0) / def.stats.length
      : 1
    // Fixed options that boost explicit values (Simplex Amulet +100%) make every option worth that much more.
    const boost = 1 + effectPct(item, m.id, true) / 100
    const tierQuality = tierQualityOf(tier) ** (steep ? 2 : 1)
    const contribution = tier > p.maxTier ? 0 : w * tierQuality * (0.85 + 0.15 * roll) * boost * (def.drop ? DROP_PREMIUM : 1)
    return { id: m.id, name: modName(m.id, lang), tier, contribution, useful: contribution >= USEFUL_MIN, note: contribution > 0 ? note : undefined }
  })
  const set = Object.keys(p.wants).filter((sid) => SET_STAT.test(sid))
  if (set.length >= 2) {
    const inSet = (v: ModVerdict) => v.contribution > 0 && MODS[v.id].stats.some(([sid]) => set.includes(sid))
    const have = mods.filter(inSet).length
    if (have < set.length) {
      const f = (have / set.length) ** 2
      for (const v of mods.filter(inSet)) Object.assign(v, { contribution: v.contribution * f, useful: v.contribution * f >= USEFUL_MIN, note: 'incompleteSet' })
    }
  }
  // Fixed options (implicits) the buyer wants count at half weight, e.g. resistances on a Two-Stone Ring.
  const implicit = item.implicits.map((m) => IMPLICIT_WEIGHT * wantOf(p, MODS[m.id].stats.map(([sid]) => sid)).w)
  const contributions = [...mods.map((m) => m.contribution), ...implicit]
  const attackBuyer = Object.keys(p.wants).some((sid) => ATTACK_STATS.includes(sid))
  const quality = baseQuality(item.base, attackBuyer)
  const usefulCount = mods.filter((m) => m.useful).length
  const single = shortfall(usefulCount)
  const elevated = ELEVATED_SURGE[Math.min(3, mods.filter((m) => m.useful && MODS[m.id].elev).length)]
  const usefulMods = mods.filter((m) => m.useful)
  const rarity = usefulMods.length ? Math.exp(usefulMods.reduce((s, m) => s + Math.log(rarityOf(item, m.id)), 0) / usefulMods.length) : 1
  const raw = p.budget * PRICE_LEVEL * GOLD_PER_CHAOS * synergy(contributions) * quality ** BASE_POWER * p.fit * p.pop * single * elevated * rarity
  const mirror = mirrorTier(item, p, mods, quality)
  const cap = MIRROR_CAP * priceOf(MIRROR)
  const value = mirror ? mirrorTierPrice(item, p.sat) : bend(raw, cap)
  const completeness = contributions.reduce((a, b) => a + b, 0) / FULL_ITEM
  return { value: Math.round(value), usefulCount, completeness, baseQuality: quality, mods, mirror, capped: !mirror && raw > cap / 2 }
}

// ---- Mirror tier (D46): the end of crafting (user: price the best items like the real ones). The Forbidden Trove league
// mirror shop (39 items, 3.28) sells copies for a Mirror of Kalandra plus a 140-200 divine fee whatever the slot, and the
// items share this: every option tier 1 or better (elevated, essence, drop-only; one tier 2 in 39), five or more of them,
// a top base, all for one build, and something plain crafting can't give (influence, elevated or drop-only options,
// Exceptional or better eldritch implicits; synthesis isn't in this game). Anything short of it bends toward MIRROR_CAP of a mirror and never
// reaches it.
// Price (user): the mirror in "a mirror + fee" is only what making the copy takes, the fee is the service. So a copy
// (mirrored) sells for a mirror plus the fee, and saturation (copies flooding that build) only eats the fee: copying is
// at worst break-even. The original is worth several mirrors, the fees its maker expects from many copies.
export const MIRROR_FEE = 160 // divines
export const MIRROR_ORIGINAL = 3 // mirrors
export const MIRROR_CAP = 0.5
export const MIRROR_BASE = 0.9 // base quality: the top base of its kind or close to it
export const mirrorTierPrice = (item: Item, sat: number) => item.mirrored
  ? priceOf(MIRROR) + MIRROR_FEE * priceOf('Divine Orb') * sat
  : MIRROR_ORIGINAL * priceOf(MIRROR) * sat
// Identity up to half the cap, then a smooth approach to the cap (better items still price higher; huge ones round to it).
export const bend = (v: number, cap: number) => (v <= cap / 2 ? v : cap / 2 + (cap / 2) * (1 - Math.exp(-(v - cap / 2) / (cap / 2))))

function mirrorTier(item: Item, p: Buyer, mods: ModVerdict[], quality: number): boolean {
  const l = affixLimits(item)
  const special = mods.some((m) => MODS[m.id].elev || MODS[m.id].drop || isInfluenced(m.id))
    || (['exarch', 'eater'] as const).some((side) => eldritchTier(item, side) >= EMBERS['Exceptional Eldritch Ember'])
  return p.build && p.fit === 1 && quality >= MIRROR_BASE && mods.length >= Math.min(FINISHED, l.prefix + l.suffix)
    && mods.every((m) => m.useful && m.tier <= 1) && special
}

// How much a build likes a base before any explicit option: base quality and the fixed options it wants, as in judge().
// Commissions ask for the base their build likes best.
export function baseAppeal(buildId: string, slot: Slot, base: string): number {
  const want = BUILDS.find((b) => b.id === buildId)?.slots[slot]
  if (!want) return 0
  const p = { wants: want.wants, stacks: STACKS.get(buildId)! }
  const implicit = BASES[base].imp.reduce((s, id) => s + IMPLICIT_WEIGHT * wantOf(p, MODS[id].stats.map(([sid]) => sid)).w, 0)
  const attackBuyer = Object.keys(want.wants).some((sid) => ATTACK_STATS.includes(sid))
  return baseQuality(base, attackBuyer) ** BASE_POWER * Math.exp(SYNERGY * implicit)
}

// ---- High-efficiency useful options (D35): options a buyer values at HIGH_EFF or more before roll and boosts (about
// tiers 1-3 of a full want; a tier-1 resistance is only 0.5, so common options never count). M = the most any single
// buyer counts, if at least 2: one good option alone is alteration-spam territory (see FULL_FROM), not luck, and
// would let a junk item fetch half a jackpot. The expected-cost model measures how lucky a craft was in M; taking the
// max over every buyer (not the one that ended up buying) keeps "some build finds this rare" from turning every roll
// into a jackpot.
export const HIGH_EFF = 0.6
const effBuyers = new Map<string, Buyer[]>()
const effMods = new Map<string, number[]>()
export function highEffCount(item: Item): number {
  const key = `${item.base}|${item.influences.join()}`
  let bs = effBuyers.get(key)
  if (!bs) effBuyers.set(key, (bs = buyers(item, 'en', 1).filter((b) => b.fit > 0))) // any day: only fit and wants matter
  const counts = bs.map(() => 0)
  for (const m of item.explicits) {
    let who = effMods.get(`${key}|${m.id}`)
    if (!who) {
      const tier = tierOf(item, m.id)
      who = []
      for (const [i, b] of bs.entries()) {
        const { w, steep } = wantOf(b, MODS[m.id].stats.map(([sid]) => sid))
        if (tier <= b.maxTier && w * tierQualityOf(tier) ** (steep ? 2 : 1) >= HIGH_EFF) who.push(i)
      }
      effMods.set(`${key}|${m.id}`, who)
    }
    for (const i of who) counts[i]++
  }
  const most = Math.max(0, ...counts)
  return most >= 2 ? most : 0
}
// Elevated options are the top of the top: one useful elevated option doubles the price, two x8, three x40.
export const ELEVATED_SURGE = [1, 2, 8, 40]

// A fractured item is no longer a clean base: its base counts for a tenth, both as the resale floor and in the
// expected cost (user decision; else (E + V) / 2 would still pay half the base back).
export const FRACTURED_BASE = 0.1
const baseShare = (item: Item) => (fractured(item) ? FRACTURED_BASE : 1)

// Expected cost to make the item: today's base price plus its crafting history (history.ts).
export const itemExpectedCost = (item: Item, day: number) =>
  expectedCost(item, basePrice(item.base, item.ilvl, day) * baseShare(item), replay, highEffCount)

// The user's rule as written (A = expected cost E, B = option value V, n = useful options for the paying build).
export const FINISHED = 5
export const finalPrice = (e: number, v: number, n: number) =>
  e < v ? Math.max(Math.round((e + v) / 2), v) : n >= FINISHED ? Math.round((e + v) / 2) : v

// Deterministic for a given item, day and meta: asking again doesn't reroll the quote.
// Price (D35, corrected by the user): if E < V then max((E + V) / 2, V) (= V), else V, except that a near-finished
// item (the paying build finds FINISHED or more of its options useful) gets (E + V) / 2: a costly good item fetches
// part of what it took to make, while a junk item never gets half its crafting cost back. Faustus shows E either way.
// Does some buyer of this base want this drop-only option (D42)? Unidentified special offers are priced by the chance
// of rolling one that is.
const appeal = new Map<string, boolean>()
export function dropAppeal(modId: string, base: string): boolean {
  // Buyers only look at the class and defence types of a base, so that is the key.
  const key = `${modId}|${BASES[base].cls}|${baseKindKeys(base).defences.join()}`
  let ok = appeal.get(key)
  if (ok === undefined) {
    const item: Item = { base, ilvl: 83, rarity: 'rare', implicits: [], explicits: [rollMod(modId, { s: 1 })], influences: [] }
    ok = buyers(item, 'en', 1).some((p) => p.fit > 0 && judge(item, p, 'en').mods[0].useful)
    appeal.set(key, ok)
  }
  return ok
}
export const slotBudget = (cls: string) => SLOT_BUDGET[slotOf(cls)]

export function quote(item: Item, lang: Lang, day: number, meta?: Meta): Quote {
  const resale = Math.round(baseResale(item.base, item.ilvl, day) * baseShare(item))
  // The weekend boom lifts what buyers pay, not the base resale floor (else buying and reselling bases would profit).
  const k = boom(day)
  const judged = buyers(item, lang, day, meta).map((p) => {
    const j = judge(item, p, lang)
    return { p, ...j, value: Math.round(j.value * k) }
  }).sort((a, b) => b.value - a.value)
  const [best] = judged
  const cost = Math.round(itemExpectedCost(item, day))
  return {
    boom: k,
    price: Math.max(FLOOR, resale, finalPrice(cost, best.value, best.usefulCount)),
    optionValue: best.value,
    expectedCost: cost,
    top: judged.filter((j) => j.value > 0).slice(0, 3).map((j) => ({ id: j.p.id, name: j.p.name, value: j.value, trend: j.p.build ? trend(meta, j.p.id, day) : null })),
    best: best.usefulCount > 0
      ? {
        id: best.p.id, name: best.p.name, fit: best.p.fit, usefulCount: best.usefulCount, completeness: best.completeness, baseQuality: best.baseQuality,
        mods: best.mods, mirror: best.mirror, capped: best.capped,
      }
      : undefined,
    baseResale: resale,
  }
}
