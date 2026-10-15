import basePricesJson from '../data/basePrices.json' with { type: 'json' }
import pricesJson from '../data/prices.json' with { type: 'json' }
import { CRAFTING } from '../engine/crafting.ts'
import type { CurrencyId } from '../engine/currency.ts'
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
