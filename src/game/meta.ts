// Build popularity inside the game. Every run rolls its own meta, it drifts daily, and two "patches" shake it up.
import buildsJson from '../data/builds.json' with { type: 'json' }
import { int, next, type Rng } from '../engine/rng.ts'

export type Slot = 'weapon' | 'offhand' | 'helmet' | 'body' | 'gloves' | 'boots' | 'ring' | 'amulet' | 'belt'
export interface SlotWant { wants: Record<string, number>; classes?: string[]; defence?: string[] }
export interface BuildProfile {
  id: string
  name: { ko: string; en: string }
  tier: 'starter' | 'advanced' | 'uber' // high-end builds pay more but only for high tiers
  share: number // real-world popularity (views + poe.ninja), sums to 1
  slots: Partial<Record<Slot, SlotWant>>
}
export const BUILDS = buildsJson as BuildProfile[]

export interface PatchNote { day: number; build: string; factor: number }
export interface Meta {
  m: Record<string, number> // popularity multiplier per build, around 1
  patchDays: number[]
  notes: PatchNote[]
}

const gauss = (rng: Rng) => Math.sqrt(-2 * Math.log(1 - next(rng))) * Math.cos(2 * Math.PI * next(rng))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function rollMeta(rng: Rng): Meta {
  return {
    m: Object.fromEntries(BUILDS.map((b) => [b.id, clamp(Math.exp(0.35 * gauss(rng)), 0.4, 2.5)])),
    patchDays: [int(rng, 4, 6), int(rng, 9, 11)],
    notes: [],
  }
}

export const PATCH_BUFF = 2
export const PATCH_NERF = 0.3

// Called when a new day starts.
export function advanceMeta(meta: Meta, day: number, rng: Rng): Meta {
  const m = Object.fromEntries(Object.entries(meta.m).map(([id, v]) => [id, clamp(v * Math.exp(0.08 * gauss(rng)), 0.3, 3)]))
  const notes = [...meta.notes]
  if (meta.patchDays.includes(day)) {
    const pool = [...BUILDS]
    const buffs = int(rng, 1, 2)
    for (let k = 0; k < 3; k++) {
      const b = pool.splice(int(rng, 0, pool.length - 1), 1)[0]
      const factor = k < buffs ? PATCH_BUFF : PATCH_NERF
      m[b.id] = clamp(m[b.id] * factor, 0.15, 5)
      notes.push({ day, build: b.id, factor })
    }
  }
  return { ...meta, m, notes }
}

const MEAN_SHARE = 1 / BUILDS.length
// Popular builds have more buyers and pay more; sqrt keeps the top build from drowning everything else.
export const popularity = (meta: Meta | undefined, id: string) =>
  Math.sqrt((BUILDS.find((b) => b.id === id)?.share ?? MEAN_SHARE) / MEAN_SHARE) * (meta?.m[id] ?? 1)

export const trend = (meta: Meta | undefined, id: string): 'rising' | 'falling' | null => {
  const v = meta?.m[id] ?? 1
  return v > 1.3 ? 'rising' : v < 0.7 ? 'falling' : null
}

export const buildName = (id: string, lang: 'ko' | 'en') => BUILDS.find((b) => b.id === id)?.name[lang] ?? id

// Build codex, kept across runs: build id -> best price it paid. A build opens once it is the paying buyer of a sale.
export type Codex = Record<string, number>
// Same object back when nothing changed, so callers can skip saving.
export function mergeCodex(codex: Codex, sales: { buyer?: string; price: number }[]): Codex {
  let out = codex
  for (const { buyer, price } of sales) {
    if (buyer && BUILDS.some((b) => b.id === buyer) && (out[buyer] ?? -1) < price) out = { ...out, [buyer]: price }
  }
  return out
}

// Day 1 is league launch, a Saturday (Korean time). The next weekend (days 8–9) everyone plays and buys: quotes rise.
// Monday the bubble pops and prices are back to normal.
export const START_WEEKDAY = 6 // 0 = Sunday
export const weekday = (day: number) => (START_WEEKDAY + day - 1) % 7
export const BOOM_DAYS = [8, 9]
export const WEEKEND_BOOM = 1.3
export const boom = (day: number) => (BOOM_DAYS.includes(day) ? WEEKEND_BOOM : 1)
