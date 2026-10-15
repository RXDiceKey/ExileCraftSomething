import basesJson from '../data/bases.json' with { type: 'json' }
import classesJson from '../data/classes.json' with { type: 'json' }
import modsJson from '../data/mods.json' with { type: 'json' }

export type Influence = 'shaper' | 'elder' | 'crusader' | 'redeemer' | 'hunter' | 'warlord'

export interface BaseDef {
  cls: string
  tags: string[]
  lvl: number
  req?: { level: number; strength: number; dexterity: number; intelligence: number }
  props: Record<string, number | { min: number; max: number }> // weapon stats are numbers, defences are ranges
  imp: string[]
  w: number
  h: number
  art: string // assets/items/<art>.png
}

export interface ModDef {
  gen: string // 'prefix' | 'suffix' for explicits; base implicits have other generation types
  type: string
  grp: string[]
  lvl: number
  stats: [id: string, min: number, max: number][]
  spawn: [tag: string, weight: number][]
  gw?: [tag: string, weight: number][]
  tags?: string[]
  adds?: string[]
  dom?: string // 'crafted' (bench) or 'delve' (fossil-only); never rolls randomly
  essenceOnly?: true
  et?: number // eldritch implicit tier 1-6 (Lesser..Perfect)
  elev?: string // elevated influence mod (Orb of Dominance): the mod family (type) it upgrades; never rolls
  drop?: 'breach' | 'delve' | 'incursion' // drop-only (D42): Grasping Mail, Azurite Mine, Temple of Atzoatl; never rolls
  on?: string[] // drop-only: item classes it appears on ("Helmet:dex_armour" when the armour attributes matter)
  dw?: number // Breachlord mod weight
}

export const BASES = basesJson as Record<string, BaseDef>
export const MODS = modsJson as Record<string, ModDef>
export const CLASS_INFLUENCE_TAGS = classesJson as Record<string, Record<Influence, string>>
