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
export interface Rumor { day: number; note: PatchNote } // heard on `day` about a coming patch change (always true)
export interface Meta {
  m: Record<string, number> // popularity multiplier per build, around 1
  patchDays: number[]
  notes: PatchNote[] // patch changes so far
  plan?: PatchNote[] // every patch change of the run, rolled at the start so rumors can leak them (older saves: none)
  rumors?: Rumor[]
  sat?: Record<string, Saturation> // demand saturation per "buyer|slot" (D37)
}

const gauss = (rng: Rng) => Math.sqrt(-2 * Math.log(1 - next(rng))) * Math.cos(2 * Math.PI * next(rng))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function rollMeta(rng: Rng): Meta {
  const m = Object.fromEntries(BUILDS.map((b) => [b.id, clamp(Math.exp(0.35 * gauss(rng)), 0.4, 2.5)]))
  const patchDays = [int(rng, 4, 6), int(rng, 9, 11)]
  return { m, patchDays, notes: [], plan: patchDays.flatMap((day) => rollPatch(day, rng)), rumors: [], sat: {} }
}

// A patch: three builds, one or two buffed, the rest nerfed.
function rollPatch(day: number, rng: Rng): PatchNote[] {
  const pool = [...BUILDS]
  const buffs = int(rng, 1, 2)
  return [0, 1, 2].map((k) => ({ day, build: pool.splice(int(rng, 0, pool.length - 1), 1)[0].id, factor: k < buffs ? PATCH_BUFF : PATCH_NERF }))
}

// Rumors (D38): RUMOR_LEAD days before a patch, word gets out about one of its changes.
export const RUMOR_LEAD = 2

// Demand saturation (D37, "recipe spread", user's numbers): NPC crafters copy what sells. After selling one item to a
// buyer for a slot, that buyer pays 15% less for that slot; two the same day 40% less, three 60%, four 80%. What's left
// carries over and recovers 5 points a day; today's drop adds on top of it, never past 80%.
export const SATURATION_DROP = [0, 0.15, 0.4, 0.6, 0.8] // by sales of that buyer/slot today
export const SATURATION_MAX = 0.8
export const SATURATION_RECOVERY = 0.05
export interface Saturation { r: number; k: number } // drop carried from earlier days, sales today
const satKey = (buyer: string, slot: Slot) => `${buyer}|${slot}`
const drop = ({ r, k }: Saturation) => Math.min(SATURATION_MAX, r + SATURATION_DROP[Math.min(k, SATURATION_DROP.length - 1)])
// Multiplier on what that buyer pays for that slot.
export const saturation = (meta: Meta | undefined, buyer: string, slot: Slot) => {
  const s = meta?.sat?.[satKey(buyer, slot)]
  return s ? 1 - drop(s) : 1
}
export const saturate = (meta: Meta, buyer: string, slot: Slot): Meta => {
  const s = meta.sat?.[satKey(buyer, slot)] ?? { r: 0, k: 0 }
  return { ...meta, sat: { ...meta.sat, [satKey(buyer, slot)]: { ...s, k: s.k + 1 } } }
}

export const PATCH_BUFF = 2
export const PATCH_NERF = 0.3

// Called when a new day starts.
export function advanceMeta(meta: Meta, day: number, rng: Rng): Meta {
  const m = Object.fromEntries(Object.entries(meta.m).map(([id, v]) => [id, clamp(v * Math.exp(0.08 * gauss(rng)), 0.3, 3)]))
  const notes = [...meta.notes]
  if (meta.patchDays.includes(day)) {
    for (const n of meta.plan ? meta.plan.filter((x) => x.day === day) : rollPatch(day, rng)) {
      m[n.build] = clamp(m[n.build] * n.factor, 0.15, 5)
      notes.push(n)
    }
  }
  const coming = (meta.plan ?? []).filter((n) => n.day === day + RUMOR_LEAD)
  const rumors = coming.length ? [...(meta.rumors ?? []), { day, note: coming[int(rng, 0, coming.length - 1)] }] : meta.rumors
  const sat = Object.fromEntries(Object.entries(meta.sat ?? {})
    .map(([key, s]): [string, Saturation] => [key, { r: Math.max(0, drop(s) - SATURATION_RECOVERY), k: 0 }]).filter(([, s]) => s.r > 0))
  return { ...meta, m, notes, rumors, sat }
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
