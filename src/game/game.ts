// Game state and every player action, as pure functions (state in -> new state out).
import { applyBench, applyEssence, applyFossils, applyMatron, benchOptions, canEssence, canFossils, CRAFTING, MATRON, matronOptions, removable, removeCrafted, resonatorFor } from '../engine/crafting.ts'
import { CURRENCIES, type CurrencyId } from '../engine/currency.ts'
import {
  applyConflict, applyEldritchAnnul, applyEldritchChaos, applyEldritchExalt, applyEldritchImplicit, canConflict, canEldritchAnnul,
  canEldritchChaos, canEldritchExalt, canEldritchImplicit, CONFLICT, ELDRITCH_ANNUL, ELDRITCH_CHAOS, ELDRITCH_EXALT, EMBERS, ICHORS,
} from '../engine/eldritch.ts'
import { beastRecipe, canImprint, canRestore, IMPRINT_BEAST, imprint, restore } from '../engine/beasts.ts'
import { canRecombine, recombine, recombineCostChaos } from '../engine/recombinator.ts'
import { tierOf } from './describe.ts'
import { harvestCraft, type Cost, type Lifeforce } from '../engine/harvest.ts'
import {
  applyVeiledChaos, applyVeiledExalt, canReveal, canUnveil, canVeiledChaos, canVeiledExalt, reveal, unveil, VEILED_CHAOS, VEILED_EXALT,
} from '../engine/veiled.ts'
import {
  applyAwaken, applyDominance, applyInfluenceExalt, AWAKENER, canAwaken, canDominance, canInfluenceExalt, DOMINANCE, INFLUENCE_EXALTS,
} from '../engine/influence.ts'
import { BASES } from '../engine/data.ts'
import { affixCounts, editable, newItem, type Item } from '../engine/item.ts'
import { int, type Rng } from '../engine/rng.ts'
import { canDeliver, refreshBoard, type Commission } from './commissions.ts'
import { rollUnidentified, unidentifiedPrice, type DropSource } from './specials.ts'
import { advanceMeta, rollMeta, saturate, type Meta } from './meta.ts'
import { advanceRivals, newRivals, type Rival, type RivalNews } from './rivals.ts'
import { basePrice, currencyPrice, GOLD_PER_CHAOS, lifeforcePrice, MIRROR, priceOf } from './shop.ts'
import { record, type StepInfo } from './history.ts'
import { highEffCount, itemExpectedCost, quote, slotOf } from './value.ts'

export const LAST_DAY = 14
export const ACTIONS_PER_DAY = 4 // sales + deliveries + hunts
export const START_GOLD = 20_000 // user decision for the P7 play test
export const HUNT_REWARD: [number, number] = [1_000, 3_000]

export interface StashItem { uid: number; item: Item }
export interface Sale { day: number; item: Item; price: number; buyer?: string } // buyer: the paying build or demand

export interface GameState {
  v: 1
  rng: Rng
  day: number
  gold: number
  pending: number // sold today, paid at day close
  used: number // sales + hunts today
  nextUid: number
  stash: StashItem[]
  sales: Sale[]
  meta: Meta // build popularity this run
  rivals: Rival[] // trade rivals (D34)
  rivalNews?: RivalNews[] // what they did at the last day close
  board?: Commission[] // commission board (D38); older saves get one on load
  goal?: number // the commission the player works towards, shown above the item (user)
  finished?: { score: number }
}

export type Result<T = GameState> = { ok: true; state: T } | { ok: false; error: string }
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

// Each action works on a copy of the RNG so the old state stays untouched (React-friendly, undo-safe).
function withRng<T>(s: GameState, f: (rng: Rng) => T): [T, Rng] {
  const rng = { ...s.rng }
  return [f(rng), rng]
}

export function newGame(seed: number): GameState {
  const rng = { s: seed }
  const meta = rollMeta(rng)
  const board = refreshBoard([], 1, LAST_DAY, meta, rng)
  return { v: 1, rng, day: 1, gold: START_GOLD, pending: 0, used: 0, nextUid: 1, stash: [], sales: [], meta, rivals: newRivals(START_GOLD), board }
}

// Older saves get what they're missing on load: build popularity (rolled now), trade rivals (starting at the start gold).
export function upgradeSave(s: GameState): GameState {
  let out = s
  if (!out.meta) {
    const rng = { ...out.rng }
    out = { ...out, meta: rollMeta(rng), rng }
  }
  if (!out.rivals) out = { ...out, rivals: newRivals(START_GOLD) }
  if (!out.board) {
    const rng = { ...out.rng }
    out = { ...out, board: refreshBoard([], out.day, LAST_DAY, out.meta, rng), rng }
  }
  return out
}

const addItem = (s: GameState, item: Item, gold: number, rng: Rng): GameState =>
  ({ ...s, rng, gold, nextUid: s.nextUid + 1, stash: [...s.stash, { uid: s.nextUid, item }] })

export function buyBase(s: GameState, base: string, ilvl: number): Result {
  if (ilvl < BASES[base].lvl) return fail('ilvlTooLow') // the base doesn't drop that low
  const price = basePrice(base, ilvl, s.day)
  if (price > s.gold) return fail('noGold')
  const [item, rng] = withRng(s, (r) => newItem(base, ilvl, r))
  return { ok: true, state: addItem(s, item, s.gold - price, rng) }
}

// An unidentified special base (D42): its drop option is rolled as it is bought.
export function buyUnidentified(s: GameState, source: DropSource, base: string): Result {
  const price = unidentifiedPrice(source, base, s.day)
  if (!price) return fail('cantApply')
  if (price > s.gold) return fail('noGold')
  const [item, rng] = withRng(s, (r) => rollUnidentified(source, base, r))
  return { ok: true, state: addItem(s, item, s.gold - price, rng) }
}

const findItem = (s: GameState, uid: number) => s.stash.find((x) => x.uid === uid)
const replaceItem = (s: GameState, uid: number, item: Item) =>
  s.stash.map((x) => (x.uid === uid ? { uid, item } : x))

// Pay, then change one stash item. The craft goes into the item's history under `key` (how to redo it, see
// replay.ts) for the expected-cost part of Faustus's quote; null keeps no record (unveil rolls, imprint restore).
function craft(
  s: GameState, uid: number, can: (i: Item) => boolean, cost: (i: Item) => number, f: (i: Item, r: Rng) => Item,
  key: string | null, more: Partial<StepInfo> = {},
): Result {
  const entry = findItem(s, uid)
  if (!entry) return fail('gone')
  if (!can(entry.item)) return fail('cantApply')
  const price = cost(entry.item)
  if (price > s.gold) return fail('noGold')
  const [made, rng] = withRng(s, (r) => f(entry.item, r))
  const item = key ? record(entry.item, made, { key, cost: price, ...more }, highEffCount) : made
  return { ok: true, state: { ...s, rng, gold: s.gold - price, stash: replaceItem(s, uid, item) } }
}

export const doCurrency = (s: GameState, uid: number, c: CurrencyId) =>
  craft(s, uid, CURRENCIES[c].can, () => currencyPrice(c), CURRENCIES[c].apply, `cur:${c}`)

export const doBench = (s: GameState, uid: number, index: number) =>
  craft(s, uid, (i) => benchOptions(i).includes(index), () => CRAFTING.bench[index].cost, (i, r) => applyBench(i, index, r), `bench:${index}`)

// The bench's "Remove crafted modifiers" costs an Orb of Scouring.
export const doRemoveCrafted = (s: GameState, uid: number) =>
  craft(s, uid, (i) => removable(i) && editable(i), () => currencyPrice('scouring'), removeCrafted, 'bench:remove')

export const doEssence = (s: GameState, uid: number, name: string) =>
  craft(s, uid, (i) => canEssence(i, name), () => priceOf(name), (i, r) => applyEssence(i, name, r), `ess:${name}`)

export const fossilCost = (item: Item, names: string[]) =>
  names.reduce((sum, n) => sum + priceOf(n), 0) + priceOf(resonatorFor(names.length, item))
export const doFossils = (s: GameState, uid: number, names: string[]) =>
  craft(s, uid, (i) => canFossils(i, names), (i) => fossilCost(i, names), (i, r) => applyFossils(i, names, r), `fos:${names.join('+')}`)

export const doMatron = (s: GameState, uid: number) =>
  craft(s, uid, (i) => matronOptions(i).length > 0, () => priceOf(MATRON), applyMatron, 'matron')

export const doInfluenceExalt = (s: GameState, uid: number, name: string) =>
  craft(s, uid, (i) => canInfluenceExalt(i, INFLUENCE_EXALTS[name]), () => priceOf(name), (i, r) => applyInfluenceExalt(i, INFLUENCE_EXALTS[name], r), `infx:${name}`)

export const doDominance = (s: GameState, uid: number) => craft(s, uid, canDominance, () => priceOf(DOMINANCE), applyDominance, 'dom')

// Awakener's Orb: the donor is destroyed and the target reforged with both influences.
export function doAwaken(s: GameState, donorUid: number, targetUid: number): Result {
  const donor = findItem(s, donorUid)
  if (!donor || donorUid === targetUid) return fail('gone')
  const r = craft(s, targetUid, (i) => canAwaken(donor.item, i), () => priceOf(AWAKENER), (i, rng) => applyAwaken(donor.item, i, rng),
    'awaken', { other: donor.item, extra: itemExpectedCost(donor.item, s.day) })
  return r.ok ? { ok: true, state: { ...r.state, stash: r.state.stash.filter((x) => x.uid !== donorUid) } } : r
}

// Embers (Searing Exarch) and Ichors (Eater of Worlds), by currency name.
export function doEldritchImplicit(s: GameState, uid: number, name: string): Result {
  const side = name in EMBERS ? 'exarch' : 'eater'
  const tier = EMBERS[name] ?? ICHORS[name]
  return craft(s, uid, (i) => canEldritchImplicit(i, side, tier), () => priceOf(name), (i, r) => applyEldritchImplicit(i, side, tier, r), `eld:${name}`)
}
export const ELDRITCH_ORBS: Record<string, { can: (i: Item) => boolean; apply: (i: Item, r: Rng) => Item }> = {
  [ELDRITCH_CHAOS]: { can: canEldritchChaos, apply: applyEldritchChaos },
  [ELDRITCH_EXALT]: { can: canEldritchExalt, apply: applyEldritchExalt },
  [ELDRITCH_ANNUL]: { can: canEldritchAnnul, apply: applyEldritchAnnul },
  [CONFLICT]: { can: canConflict, apply: applyConflict },
}
export const doEldritchOrb = (s: GameState, uid: number, name: string) =>
  craft(s, uid, ELDRITCH_ORBS[name].can, () => priceOf(name), ELDRITCH_ORBS[name].apply, `eldorb:${name}`)

// Harvest crafts, paid in Crystallised Lifeforce at that day's price.
export const harvestCost = (cost: Cost, day: number) =>
  Math.round(Object.entries(cost).reduce((sum, [k, n]) => sum + n * lifeforcePrice(k as Lifeforce, day), 0))
export function doHarvest(s: GameState, uid: number, id: string): Result {
  const c = harvestCraft(id)
  return craft(s, uid, c.can, () => harvestCost(c.cost, s.day), c.apply, `harv:${id}`)
}

// Beastcrafting: a recipe costs its named beasts.
export const beastCost = (beasts: string[]) => beasts.reduce((sum, b) => sum + priceOf(b), 0)
export function doBeast(s: GameState, uid: number, id: string): Result {
  const r = beastRecipe(id)
  return craft(s, uid, r.can, () => beastCost(r.beasts), r.apply, `beast:${id}`)
}
// The Craicic Croaker makes the imprint; using the imprint later costs nothing more.
export const doImprint = (s: GameState, uid: number) => craft(s, uid, canImprint, () => priceOf(IMPRINT_BEAST), imprint, 'imprint')
export const doRestore = (s: GameState, uid: number) => craft(s, uid, canRestore, () => 0, restore, null) // back to the imprint's own history

export const VEILED_ORBS: Record<string, { can: (i: Item) => boolean; apply: (i: Item, r: Rng) => Item }> = {
  [VEILED_CHAOS]: { can: canVeiledChaos, apply: applyVeiledChaos },
  [VEILED_EXALT]: { can: canVeiledExalt, apply: applyVeiledExalt },
}
export const doVeiledOrb = (s: GameState, uid: number, name: string) =>
  craft(s, uid, VEILED_ORBS[name].can, () => priceOf(name), VEILED_ORBS[name].apply, `veil:${name}`)
// Unveiling is free: first look rolls the three choices (kept), then pick one.
export const doReveal = (s: GameState, uid: number) => craft(s, uid, canReveal, () => 0, reveal, null)
export const doUnveil = (s: GameState, uid: number, choice: string) =>
  craft(s, uid, (i) => canUnveil(i, choice), () => 0, (i, r) => unveil(i, choice, r), `unveil:${choice}`)

// Kingsmarch recombinator (random mode): both items are used up, the result joins the stash as a new item.
export const recombineCost = (a: Item, b: Item) => recombineCostChaos(a, b, tierOf) * GOLD_PER_CHAOS
export function doRecombine(s: GameState, uidA: number, uidB: number): Result {
  const a = findItem(s, uidA)
  const b = findItem(s, uidB)
  if (!a || !b) return fail('gone')
  if (!canRecombine(a.item, b.item)) return fail('cantApply')
  const price = recombineCost(a.item, b.item)
  if (price > s.gold) return fail('noGold')
  const [made, rng] = withRng(s, (r) => recombine(a.item, b.item, r))
  const item = record(a.item, made, { key: 'recomb', cost: price, other: b.item, extra: itemExpectedCost(b.item, s.day) }, highEffCount)
  const rest = { ...s, stash: s.stash.filter((x) => x.uid !== uidA && x.uid !== uidB) }
  return { ok: true, state: addItem(rest, item, s.gold - price, rng) }
}

// Mirror of Kalandra: a mirrored (unmodifiable) copy joins the stash; the original stays as it is.
export function doMirror(s: GameState, uid: number): Result {
  const entry = findItem(s, uid)
  if (!entry) return fail('gone')
  if (entry.item.mirrored) return fail('cantApply')
  const price = priceOf(MIRROR)
  if (price > s.gold) return fail('noGold')
  const copy = record(entry.item, { ...entry.item, mirrored: true }, { key: 'mirror', cost: price, fixed: true }, highEffCount)
  return { ok: true, state: addItem(s, copy, s.gold - price, s.rng) }
}

export interface SpamOptions { augPrefix: boolean; augSuffix: boolean; maxTries: number; goldCap: number }
export interface SpamReport {
  state: GameState
  alts: number
  augs: number
  spent: number
  stop: 'matched' | 'maxTries' | 'goldCap' | 'noGold' | 'notMagic'
}

// "변옵 스팸머신": Alteration until the item matches the search (optionally Augmenting an empty side).
// Same RNG as clicking by hand, so results are identical — it only saves clicks.
export function spamAlteration(s: GameState, uid: number, matches: (item: Item) => boolean, o: SpamOptions): SpamReport {
  const entry = findItem(s, uid)
  let item = entry?.item
  let gold = s.gold
  let alts = 0, augs = 0, spent = 0
  const rng = { ...s.rng }
  const done = (stop: SpamReport['stop']): SpamReport =>
    ({ state: item ? { ...s, rng, gold, stash: replaceItem(s, uid, item) } : s, alts, augs, spent, stop })
  // A press always rolls, even on an item that already matches (user: pressing again runs it again).
  if (!item || !CURRENCIES.alteration.can(item)) return done('notMagic')
  // Same record as clicking by hand.
  const step = (i: Item, c: 'alteration' | 'augmentation') => {
    const made = CURRENCIES[c].apply(i, rng)
    return record(i, made, { key: `cur:${c}`, cost: currencyPrice(c) }, highEffCount)
  }
  const pay = (price: number): SpamReport['stop'] | null => {
    if (spent + price > o.goldCap) return 'goldCap'
    if (price > gold) return 'noGold'
    gold -= price
    spent += price
    return null
  }

  for (;;) {
    if (alts >= o.maxTries) return done('maxTries')
    const stop = pay(currencyPrice('alteration'))
    if (stop) return done(stop)
    item = step(item, 'alteration')
    alts++
    if (matches(item)) return done('matched')
    const c = affixCounts(item)
    if ((c.prefix === 0 && o.augPrefix) || (c.suffix === 0 && o.augSuffix)) {
      const stop = pay(currencyPrice('augmentation'))
      if (stop) return done(stop)
      item = step(item, 'augmentation')
      augs++
      if (matches(item)) return done('matched')
    }
  }
}

// "사냥 파밍": spend one of today's 4 actions for a little gold right now (the way out of bankruptcy).
export function hunt(s: GameState): Result<{ state: GameState; reward: number }> {
  if (s.used >= ACTIONS_PER_DAY) return fail('noActions')
  const [reward, rng] = withRng(s, (r) => int(r, ...HUNT_REWARD))
  return { ok: true, state: { state: { ...s, rng, gold: s.gold + reward, used: s.used + 1 }, reward } }
}

// Filling a commission: the item goes, the reward comes at the next day close, like a sale (and uses one).
export function deliver(s: GameState, uid: number, id: number): Result {
  if (s.used >= ACTIONS_PER_DAY) return fail('noActions')
  const entry = findItem(s, uid)
  const c = s.board?.find((x) => x.id === id)
  if (!entry || !c) return fail('gone')
  if (!canDeliver(entry.item, c)) return fail('cantApply')
  return {
    ok: true,
    state: {
      ...s, used: s.used + 1, pending: s.pending + c.reward, stash: s.stash.filter((x) => x.uid !== uid),
      sales: [...s.sales, { day: s.day, item: entry.item, price: c.reward, buyer: c.build }], board: s.board!.filter((x) => x !== c),
    },
  }
}

// Selling at Faustus's quote; the gold arrives at the next day close.
export function sell(s: GameState, uid: number): Result<{ state: GameState; price: number }> {
  if (s.used >= ACTIONS_PER_DAY) return fail('noActions')
  const entry = findItem(s, uid)
  if (!entry) return fail('gone')
  const q = quote(entry.item, 'en', s.day, s.meta)
  const price = q.price
  const meta = q.best ? saturate(s.meta, q.best.id, slotOf(BASES[entry.item.base].cls)) : s.meta
  return {
    ok: true,
    state: {
      state: {
        ...s, meta, used: s.used + 1, pending: s.pending + price,
        stash: s.stash.filter((x) => x.uid !== uid), sales: [...s.sales, { day: s.day, item: entry.item, price, ...(q.best && { buyer: q.best.id }) }],
      },
      price,
    },
  }
}

export function closeDay(s: GameState): GameState {
  const settled = { ...s, gold: s.gold + s.pending, pending: 0, used: 0 }
  // Rivals close their day too (the last one included), measured against the player's settled gold.
  const [moved, rng0] = withRng(s, (r) => advanceRivals(s.rivals, settled.gold, START_GOLD, r))
  const withRivals = { ...settled, rng: rng0, rivals: moved.rivals, rivalNews: moved.news }
  if (s.day >= LAST_DAY) return { ...withRivals, finished: { score: settled.gold } }
  const rng = { ...rng0 }
  const meta = advanceMeta(s.meta, s.day + 1, rng)
  const board = refreshBoard(s.board ?? [], s.day + 1, LAST_DAY, meta, rng)
  return { ...withRivals, rng, meta, board, day: s.day + 1 }
}
