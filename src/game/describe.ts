// Turns an item into display text: option lines (game wording), option names, tiers. Both languages.
import statsJson from '../data/stats.json' with { type: 'json' }
import textEnJson from '../data/text.en.json' with { type: 'json' }
import textKoJson from '../data/text.ko.json' with { type: 'json' }
import { BASES, MODS, type Influence } from '../engine/data.ts'
import { modInfluence } from '../engine/influence.ts'
import { itemTags, spawnWeight, type Item, type RolledMod } from '../engine/item.ts'

export type Lang = 'ko' | 'en'

interface Cond { min?: number; max?: number; negated?: boolean }
interface StatEntry { ids: string[]; v: { c: Cond[]; f: string[]; h: string[][] }[] }
interface Text {
  mods: Record<string, string>
  bases: Record<string, string>
  classes: Record<string, string>
  stats: (string[] | { v: number; s: string } | null)[] // en: string per variant; ko: one string for variant v
  game: Record<string, string> // the game's own UI strings (ClientStrings), see build-data GAME_STRINGS
  harvest: Record<string, string> // harvest craft wording by the game's craft id
  bestiary: Record<string, string> // beastcraft wording by the game's recipe id
}

const STATS = statsJson as StatEntry[]
const TEXT = { en: textEnJson as Text, ko: textKoJson as Text }

// stat id -> translation entries containing it
const entriesByStat = new Map<string, number[]>()
STATS.forEach((e, i) => e.ids.forEach((id) => entriesByStat.set(id, [...(entriesByStat.get(id) ?? []), i])))

const HANDLERS: Record<string, (v: number) => number> = {
  negate: (v) => -v,
  divide_by_one_hundred: (v) => v / 100,
  per_minute_to_per_second: (v) => v / 60,
  per_minute_to_per_second_2dp_if_required: (v) => v / 60,
  milliseconds_to_seconds: (v) => v / 1000,
  locations_to_metres: (v) => v / 10,
  canonical_stat: (v) => v,
}

const fmtNumber = (v: number) => String(Math.round(v * 100) / 100)

const matches = (c: Cond, v: number) => {
  const inside = (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max)
  return c.negated ? !inside : inside
}

function render(entryIdx: number, values: number[], lang: Lang): string {
  const e = STATS[entryIdx]
  const vi = e.v.findIndex((v) => v.c.every((c, i) => matches(c, values[i])))
  if (vi < 0) return ''
  let variant = e.v[vi]
  let template = (TEXT.en.stats[entryIdx] as string[])[vi]
  const ko = TEXT.ko.stats[entryIdx]
  // Game text (stat_descriptions.txt): one Korean line per variant, like English.
  if (lang === 'ko' && Array.isArray(ko)) template = ko[vi]
  else if (lang === 'ko' && ko && !Array.isArray(ko)) {
    // Korean has one sentence per stat (trade site). Off-variant values (e.g. "reduced") render through that
    // sentence with their raw sign, i.e. "-10% 증가".
    variant = e.v[ko.v]
    template = ko.s
  }
  if (!template) return ''
  return template.replace(/\{(\d+)\}/g, (_, i) => {
    let v = values[+i]
    for (const h of variant.h[+i] ?? []) v = HANDLERS[h]?.(v) ?? v
    return (variant.f[+i] === '+#' && v >= 0 ? '+' : '') + fmtNumber(v)
  })
}

// A stat's wording with "#" for its numbers, keyed by its line (stats sharing a line give the same key). Build codex.
export function statLabel(sid: string, lang: Lang): [number, string] | undefined {
  const idx = entriesByStat.get(sid)?.[0]
  if (idx === undefined) return undefined
  const text = render(idx, STATS[idx].ids.map(() => 10), lang)
  return text ? [idx, text.replace(/\d+(\.\d+)?/g, '#').replace(/\n/g, ' / ')] : undefined
}

// The game's line for some stats at given values (commission asks: "화염 저항 +40%"); stats sharing a line go together.
export function statLine(values: Record<string, number>, lang: Lang): string {
  const first = Object.keys(values)[0]
  const idx = entriesByStat.get(first)?.[0]
  if (idx === undefined) return first
  return render(idx, STATS[idx].ids.map((id) => values[id] ?? 0), lang).replace(/\n/g, ' / ')
}

// Fixed options like "+100% effect of explicit modifiers" (Simplex Amulet) scale the explicit values.
export function modEffect(item: Item, gen: string): number {
  let pct = 0
  for (const m of item.implicits) {
    MODS[m.id].stats.forEach(([sid], i) => {
      if (sid === 'local_explicit_mod_effect_+%' || sid === `local_${gen}_mod_effect_+%`) pct += m.values[i]
    })
  }
  return pct
}

// % increased effect on a mod: Simplex-style "explicit modifier effect" (explicits only).
export const effectPct = (item: Item, modId: string, explicit: boolean) => (explicit ? modEffect(item, MODS[modId].gen) : 0)

export function effectiveValues(item: Item, m: RolledMod, explicit: boolean): number[] {
  const pct = effectPct(item, m.id, explicit)
  return pct ? m.values.map((v) => Math.trunc((v * (100 + pct)) / 100)) : m.values
}

const PRESENCE: Record<string, string> = {
  local_influence_mod_requires_unique_monster_presence: 'presenceUnique',
  local_influence_mod_requires_celestial_boss_presence: 'presencePinnacle',
}
export const bestiaryText = (id: string, lang: Lang) => TEXT[lang].bestiary[id] ?? TEXT.en.bestiary[id] ?? id
export const harvestText = (id: string, lang: Lang) => TEXT[lang].harvest[id] ?? TEXT.en.harvest[id] ?? id
export const gameText = (lang: Lang, key: string, arg = '') => (TEXT[lang].game[key] ?? TEXT.en.game[key] ?? key).replace('{0}', arg)

export function modText(item: Item, m: RolledMod, explicit: boolean, lang: Lang): string[] {
  // A veiled placeholder shows just "Veiled Prefix" / "Veiled Suffix" until it is unveiled.
  if (MODS[m.id].dom === 'veiled') return [gameText(lang, MODS[m.id].gen === 'prefix' ? 'veiledPrefix' : 'veiledSuffix')]
  const stats = MODS[m.id].stats.map(([id]) => id)
  const values = effectiveValues(item, m, explicit)
  const lines: string[] = []
  const done = new Set<number>()
  for (const sid of stats) {
    for (const idx of entriesByStat.get(sid) ?? []) {
      if (done.has(idx)) continue
      done.add(idx)
      const vals = STATS[idx].ids.map((id) => { const k = stats.indexOf(id); return k < 0 ? 0 : values[k] })
      // Like the game, a line whose numbers are all 0 isn't shown ("+1 to maximum number of Spectres" carries a 0 for
      // zombies and skeletons).
      if (vals.every((v) => v === 0)) continue
      const line = render(idx, vals, lang)
      if (line) lines.push(...line.split('\n'))
    }
  }
  // Eldritch presence mods: "While a Unique Enemy is in your Presence, <line>"
  const presence = stats.map((s) => PRESENCE[s]).find(Boolean)
  return presence ? lines.map((l) => gameText(lang, presence, l)) : lines
}

// Tier 1 = best version of this option that can roll on the base (by required level), like Craft of Exile.
const tierCache = new Map<string, number>()
// 1 = best tier that can roll here; 0 = elevated (above tier 1, only from an Orb of Dominance).
// Influence mods are ranked within their own influence (Shaper's and Hunter's versions of a family are separate ladders).
export function tierOf(item: Item, modId: string): number {
  if (MODS[modId].elev) return 0
  if (MODS[modId].drop) return 1 // drop-only options have no ladder; they're as good as it gets (D42)
  const key = `${item.base}|${item.influences.join()}|${modId}`
  let t = tierCache.get(key)
  if (t === undefined) {
    const m = MODS[modId]
    const inf = modInfluence(modId)
    const tags = itemTags({ ...item, explicits: [] })
    const higher = Object.keys(MODS).filter((id) => {
      const o = MODS[id]
      return o.type === m.type && o.gen === m.gen && o.lvl > m.lvl && spawnWeight(id, tags) > 0 && modInfluence(id) === inf
    })
    t = higher.length + 1
    tierCache.set(key, t)
  }
  return t
}

export const baseName = (base: string, lang: Lang) => TEXT[lang].bases[base] ?? TEXT.en.bases[base] ?? base
export const modName = (id: string, lang: Lang) => TEXT[lang].mods[id] ?? ''
export const className = (cls: string, lang: Lang) => TEXT[lang].classes[cls] ?? cls

export function itemName(item: Item, lang: Lang): string {
  const base = baseName(item.base, lang)
  if (item.rarity !== 'magic') return base
  const pre = item.explicits.find((m) => MODS[m.id].gen === 'prefix')
  const suf = item.explicits.find((m) => MODS[m.id].gen === 'suffix')
  return [pre && modName(pre.id, lang), base, suf && modName(suf.id, lang)].filter(Boolean).join(' ')
}

export interface ModLine {
  kind: 'implicit' | 'prefix' | 'suffix'
  id: string
  name: string
  tier?: number
  text: string[]
  crafted?: true
  fractured?: true
  drop?: 'breach' | 'delve' | 'incursion'
}

export function modLines(item: Item, lang: Lang): ModLine[] {
  const imp = item.implicits.map((m): ModLine => ({ kind: 'implicit', id: m.id, name: '', text: modText(item, m, false, lang) }))
  const exp = [...item.explicits]
    .sort((a, b) => (MODS[a.id].gen === 'prefix' ? 0 : 1) - (MODS[b.id].gen === 'prefix' ? 0 : 1))
    .map((m): ModLine => ({
      kind: MODS[m.id].gen as 'prefix' | 'suffix',
      id: m.id,
      name: modName(m.id, lang),
      tier: tierOf(item, m.id),
      text: modText(item, m, true, lang),
      ...(m.crafted && { crafted: true as const }),
      ...(m.fractured && { fractured: true as const }),
      ...(MODS[m.id].drop && { drop: MODS[m.id].drop }),
    }))
  return [...imp.filter((l) => l.text.length), ...exp]
}

export const itemClass = (item: Item) => BASES[item.base].cls
export const baseArt = (base: string) => `items/${BASES[base].art}.png`

// "에너지 보호막 · 지능": defence type (armour pieces, from tags) + attribute (from tags or requirements).
const KIND: Record<Lang, Record<string, string>> = {
  ko: { str: '힘', dex: '민첩', int: '지능', armour: '방어도', evasion: '회피', es: '에너지 보호막', ward: '수호' },
  en: { str: 'Str', dex: 'Dex', int: 'Int', armour: 'Armour', evasion: 'Evasion', es: 'Energy Shield', ward: 'Ward' },
}
const DEFENCE_OF = { str: 'armour', dex: 'evasion', int: 'es' } as const
export const defenceName = (d: string, lang: Lang) => KIND[lang][d] ?? d
export function baseKindKeys(base: string): { defences: string[]; attrs: string[] } {
  const b = BASES[base]
  const armourTag = b.tags.find((t) => /^(str|dex|int)(_(dex|int))*_armour$/.test(t))
  const attrs = armourTag
    ? armourTag.replace('_armour', '').split('_')
    : (['str', 'dex', 'int'] as const).filter((a) => (b.req?.[a === 'str' ? 'strength' : a === 'dex' ? 'dexterity' : 'intelligence'] ?? 0) > 0)
  const defences = b.tags.includes('ward_armour') ? ['ward'] : armourTag ? attrs.map((a) => DEFENCE_OF[a as keyof typeof DEFENCE_OF]) : []
  return { defences, attrs: [...attrs] }
}

export function baseKind(base: string, lang: Lang): string {
  const { defences, attrs } = baseKindKeys(base)
  return [defences.map((d) => KIND[lang][d]).join('/'), attrs.map((a) => KIND[lang][a]).join('/')].filter(Boolean).join(' · ')
}

const RARITY: Record<Lang, Record<Item['rarity'], string>> = {
  ko: { normal: '일반', magic: '마법', rare: '희귀' },
  en: { normal: 'Normal', magic: 'Magic', rare: 'Rare' },
}
export const rarityName = (item: Item, lang: Lang) => RARITY[lang][item.rarity]

// The line an influenced item shows (and what stash search matches): "엘더 아이템" / "Elder Item".
const INFLUENCE_NAME: Record<Lang, Record<Influence, string>> = {
  ko: { shaper: '쉐이퍼 아이템', elder: '엘더 아이템', crusader: '십자군 아이템', redeemer: '대속자 아이템', hunter: '사냥꾼 아이템', warlord: '전쟁군주 아이템' },
  en: { shaper: 'Shaper Item', elder: 'Elder Item', crusader: 'Crusader Item', redeemer: 'Redeemer Item', hunter: 'Hunter Item', warlord: 'Warlord Item' },
}
export const influenceName = (inf: Influence, lang: Lang) => INFLUENCE_NAME[lang][inf]

// Eldritch implicits as the game labels them: "작열의 총주교 고정 속성 (우수한)", and the item line "작열의 총주교 아이템".
const ELDRITCH_GEN: Record<string, 'exarch' | 'eater'> = { searing_exarch_implicit: 'exarch', eater_of_worlds_implicit: 'eater' }
export function eldritchLabel(modId: string, lang: Lang): string | undefined {
  const side = ELDRITCH_GEN[MODS[modId].gen]
  return side && gameText(lang, `${side}Implicit`, gameText(lang, `eldritchTier${MODS[modId].et}`))
}
export const eldritchItemLines = (item: Item, lang: Lang) =>
  [...new Set(item.implicits.map((m) => ELDRITCH_GEN[MODS[m.id].gen]).filter(Boolean))].map((side) => gameText(lang, `${side}Item`))

// What the regex search runs against: name, rarity, every option line and option name.
export function searchText(item: Item, lang: Lang): string {
  const lines = modLines(item, lang)
  return [
    itemName(item, lang),
    baseName(item.base, lang),
    `${lang === 'ko' ? '아이템 희귀도' : 'Rarity'}: ${rarityName(item, lang)}`,
    ...item.influences.map((i) => influenceName(i, lang)),
    ...eldritchItemLines(item, lang),
    ...lines.flatMap((l) => [...l.text, l.name]),
  ].filter(Boolean).join('\n')
}

// "+(15-25) to maximum Life": an option's full roll range, PoE style (for bench crafts and essences).
export function rangeText(item: Item, modId: string, lang: Lang): string[] {
  const stats = MODS[modId].stats
  const lo = modText(item, { id: modId, values: stats.map(([, a, b]) => Math.min(a, b)) }, true, lang)
  const hi = modText(item, { id: modId, values: stats.map(([, a, b]) => Math.max(a, b)) }, true, lang)
  return lo.map((line, i) => {
    const a = line.split(/(-?\d+(?:\.\d+)?)/)
    const b = (hi[i] ?? line).split(/(-?\d+(?:\.\d+)?)/)
    // Negative ranges read like the game: "-(8-6)", not "(-8--6)".
    // A "reduced" line shows magnitudes, which can come out high-to-low: keep them low-to-high.
    const range = (x: string, y: string) => (+x < 0 && +y < 0 ? `-(${-x}-${-y})` : +x > +y ? `(${y}-${x})` : `(${x}-${y})`)
    return a.map((tok, k) => (k % 2 && b[k] !== undefined && b[k] !== tok ? range(tok, b[k]) : tok)).join('')
  })
}
