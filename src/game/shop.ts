import basePricesJson from '../data/basePrices.json' with { type: 'json' }
import pricesJson from '../data/prices.json' with { type: 'json' }
import { CRAFTING } from '../engine/crafting.ts'
import { BASES } from '../engine/data.ts'
import type { CurrencyId } from '../engine/currency.ts'
import { LIFEFORCE, type Lifeforce } from '../engine/harvest.ts'
import type { Lang } from './describe.ts'

export const GOLD_PER_CHAOS = 100
const BASE_PRICES = basePricesJson as Record<string, Record<string, number>> // base -> ilvl (82-86) -> gold
const PRICES = pricesJson as Record<string, number>

// Every currency is known by its English name; Korean name and icon come from assets/currency/currency_icons.csv.
export const CURRENCY_EN: Record<CurrencyId, string> = {
  transmutation: 'Orb of Transmutation', alteration: 'Orb of Alteration', augmentation: 'Orb of Augmentation',
  regal: 'Regal Orb', alchemy: 'Orb of Alchemy', binding: 'Orb of Binding', chaos: 'Chaos Orb', exalted: 'Exalted Orb',
  annulment: 'Orb of Annulment', divine: 'Divine Orb', blessed: 'Blessed Orb', scouring: 'Orb of Scouring',
  vaal: 'Vaal Orb', fracturing: 'Fracturing Orb', whetstone: "Blacksmith's Whetstone", scrap: "Armourer's Scrap",
}
export const MIRROR = 'Mirror of Kalandra'

export const priceOf = (en: string) => PRICES[en] ?? GOLD_PER_CHAOS // ponytail: unpriced currency costs a chaos
export const nameOf = (en: string, lang: Lang) => (lang === 'ko' ? CRAFTING.currencies[en]?.ko ?? en : en)
export const iconOf = (en: string) => `currency/${CRAFTING.currencies[en]?.icon ?? ''}`
export const currencyPrice = (c: CurrencyId) => priceOf(CURRENCY_EN[c])

// Lifeforce (user): at league start every colour sells for about the same. After day VIVID_FROM yellow (Vivid) climbs to
// its late-league market price, reached on VIVID_FULL; Wild and Primal stay level. Sacred and Rancour: market price.
export const LIFEFORCE_EARLY = 3 // gold each, between Wild (2) and Primal (4) in the late-league snapshot
export const VIVID_FROM = 7
export const VIVID_FULL = 11
export function lifeforcePrice(kind: Lifeforce, day: number): number {
  if (kind === 'wild' || kind === 'primal') return LIFEFORCE_EARLY
  if (kind !== 'vivid') return priceOf(LIFEFORCE[kind])
  const t = Math.min(1, Math.max(0, (day - VIVID_FROM) / (VIVID_FULL - VIVID_FROM)))
  return LIFEFORCE_EARLY + (priceOf(LIFEFORCE.vivid) - LIFEFORCE_EARLY) * t
}

// Market snapshot is late-league (cheap). Early in a run high-ilvl bases are scarce: day 1 x P, back to x1 on day 7.
const PREMIUM_DAY1: Record<number, number> = { 86: 10, 85: 6, 84: 4, 83: 2, 82: 1.5 }
export function premium(day: number, ilvl: number): number {
  const p = PREMIUM_DAY1[ilvl] ?? 1
  return 1 + (p - 1) * Math.max(0, (7 - day) / 6)
}

const LOW_ILVL_FACTOR = 0.3 // ponytail: no market data below ilvl 82; flat discount, tune in P7

// Shop price of a plain (uninfluenced) base on a given day. Influenced bases are never sold.
export function basePrice(base: string, ilvl: number, day: number): number {
  const byIlvl = BASE_PRICES[base]
  const market = ilvl >= 82 ? byIlvl[ilvl] : Math.max(GOLD_PER_CHAOS, byIlvl[82] * LOW_ILVL_FACTOR)
  return Math.round(market * premium(day, ilvl))
}

export const RESALE_RATE = 0.9 // Faustus always pays 90% of the same base's price that day, no scouring needed
export const baseResale = (base: string, ilvl: number, day: number) => Math.round(RESALE_RATE * basePrice(base, ilvl, day))

export const buyableBases = () => Object.keys(BASE_PRICES)

// What the shop shows first (user): the top TOP_PER_GROUP bases (by level) of each weapon class and of each armour class
// per attribute mix, plus the special bases (atlas / experimental ones, each its own thing). Jewellery and quivers differ
// by their fixed option, so they all show. The rest waits behind "lower bases".
export const TOP_PER_GROUP = 2
const SPECIAL_TAGS = ['atlas_base_type', 'experimental_base'] // not 'not_for_sale': the newer top bases carry it too
const ARMOUR = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield']
const OTHER = ['Ring', 'Amulet', 'Belt', 'Quiver']
export const isSpecialBase = (id: string) => BASES[id].tags.some((t) => SPECIAL_TAGS.includes(t))
export const baseGroup = (id: string) => {
  const b = BASES[id]
  if (OTHER.includes(b.cls)) return null
  if (!ARMOUR.includes(b.cls)) return b.cls
  return `${b.cls}|${b.tags.find((t) => /^((str|dex|int)(_(dex|int))*|ward)_armour$/.test(t)) ?? ''}`
}
let top: Set<string> | undefined
export function isTopBase(id: string): boolean {
  if (!top) {
    const groups = new Map<string, string[]>()
    for (const b of buyableBases()) {
      const g = baseGroup(b)
      if (g !== null && !isSpecialBase(b)) groups.set(g, [...(groups.get(g) ?? []), b])
    }
    top = new Set([...groups.values()].flatMap((bs) => bs.sort((a, b) => BASES[b].lvl - BASES[a].lvl).slice(0, TOP_PER_GROUP)))
  }
  return baseGroup(id) === null || isSpecialBase(id) || top.has(id)
}
