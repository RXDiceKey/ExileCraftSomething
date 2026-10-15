// Redo a recorded craft from its key (game/history.ts measures how lucky each step was this way). Keys are written by
// game.ts: "cur:chaos", "ess:<essence>", "fos:<fossil>+<fossil>", "harv:<craft id>", "beast:<recipe id>", ...
// Returns undefined when the craft can't be redone on that state.
import { beastRecipe } from '../engine/beasts.ts'
import { applyMatron, applyEssence, applyFossils } from '../engine/crafting.ts'
import { CURRENCIES, type CurrencyId } from '../engine/currency.ts'
import {
  applyConflict, applyEldritchAnnul, applyEldritchChaos, applyEldritchExalt, applyEldritchImplicit, CONFLICT, ELDRITCH_ANNUL, ELDRITCH_CHAOS,
  ELDRITCH_EXALT, EMBERS, ICHORS,
} from '../engine/eldritch.ts'
import { harvestCraft } from '../engine/harvest.ts'
import { applyAwaken, applyDominance, applyInfluenceExalt, INFLUENCE_EXALTS } from '../engine/influence.ts'
import type { Item } from '../engine/item.ts'
import { recombine } from '../engine/recombinator.ts'
import type { Rng } from '../engine/rng.ts'
import { applyVeiledChaos, applyVeiledExalt, VEILED_CHAOS, VEILED_EXALT } from '../engine/veiled.ts'

const ELDRITCH_ORBS: Record<string, (i: Item, r: Rng) => Item> = {
  [ELDRITCH_CHAOS]: applyEldritchChaos, [ELDRITCH_EXALT]: applyEldritchExalt, [ELDRITCH_ANNUL]: applyEldritchAnnul, [CONFLICT]: applyConflict,
}
const VEILED_ORBS: Record<string, (i: Item, r: Rng) => Item> = { [VEILED_CHAOS]: applyVeiledChaos, [VEILED_EXALT]: applyVeiledExalt }

export function replay(key: string, before: Item, other: Item | undefined, rng: Rng): Item | undefined {
  const at = key.indexOf(':')
  const kind = at < 0 ? key : key.slice(0, at)
  const arg = at < 0 ? '' : key.slice(at + 1)
  switch (kind) {
    case 'cur': {
      const c = CURRENCIES[arg as CurrencyId]
      return c?.can(before) ? c.apply(before, rng) : undefined
    }
    case 'ess': return applyEssence(before, arg, rng)
    case 'fos': return applyFossils(before, arg.split('+'), rng)
    case 'matron': return applyMatron(before, rng)
    case 'infx': return applyInfluenceExalt(before, INFLUENCE_EXALTS[arg], rng)
    case 'dom': return applyDominance(before, rng)
    case 'awaken': return other && applyAwaken(other, before, rng)
    case 'eld': return arg in EMBERS ? applyEldritchImplicit(before, 'exarch', EMBERS[arg], rng) : applyEldritchImplicit(before, 'eater', ICHORS[arg], rng)
    case 'eldorb': return ELDRITCH_ORBS[arg]?.(before, rng)
    case 'harv': return harvestCraft(arg).apply(before, rng)
    case 'beast': return beastRecipe(arg)?.apply(before, rng)
    case 'veil': return VEILED_ORBS[arg]?.(before, rng)
    case 'recomb': return other && recombine(before, other, rng)
    default: return undefined
  }
}
