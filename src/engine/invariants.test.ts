// Every craft in the game, applied at random to many items: after each step the item must still be one the game allows.
// Catches the basic rules a single craft can forget (two mods of one mod group, too many prefixes, a lost fractured mod...).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import basePricesJson from '../data/basePrices.json' with { type: 'json' }
import { BEAST_LEVEL, BEAST_RECIPES, canImprint, canRestore, imprint, restore } from './beasts.ts'
import { applyBench, applyEssence, applyFossils, applyMatron, benchOptions, canEssence, canFossils, CRAFTING, craftedCount, matronOptions, removable, removeCrafted } from './crafting.ts'
import { CURRENCIES, type CurrencyId } from './currency.ts'
import { BASES, MODS, type Influence } from './data.ts'
import { applyConflict, applyEldritchAnnul, applyEldritchChaos, applyEldritchExalt, applyEldritchImplicit, canConflict, canEldritchAnnul, canEldritchChaos, canEldritchExalt, canEldritchImplicit, eldritchSide, type Eldritch } from './eldritch.ts'
import { HARVEST } from './harvest.ts'
import { applyAwaken, applyDominance, applyInfluenceExalt, canAwaken, canDominance, canInfluenceExalt, INFLUENCES, modInfluence } from './influence.ts'
import { addRandomMod, affixCounts, affixLimits, itemTags, metamods, newItem, spawnWeight, type Item } from './item.ts'
import { canRecombine, recombine } from './recombinator.ts'
import { int, next, type Rng } from './rng.ts'
import { applyVeiledChaos, applyVeiledExalt, canReveal, canUnveil, canVeiledChaos, canVeiledExalt, isVeiled, reveal, unveil } from './veiled.ts'

const BASE_IDS = Object.keys(basePricesJson as Record<string, unknown>)
const ARMOUR_IDS = BASE_IDS.filter((b) => ['Body Armour', 'Helmet', 'Gloves', 'Boots'].includes(BASES[b].cls))
const ESSENCES = Object.keys(CRAFTING.essences)
// Essences force their mod whatever the base's own pool or the item level says ("cls|mod").
const ESSENCE_MODS = new Set(Object.values(CRAFTING.essences).flatMap((e) => Object.entries(e.mods).map(([cls, id]) => `${cls}|${id}`)))
const FOSSILS = Object.keys(CRAFTING.fossils)
const pick = <T>(rng: Rng, xs: T[]) => xs[int(rng, 0, xs.length - 1)]

// One craft: whether it can be used on `item` (with `other` as a second item where it needs one) and what it does.
// makesNew: a new item from two (the recombinator). carries: moves or raises a mod without an item level check (PLAN §3.3).
interface Op { name: string; can: (item: Item, other: Item) => boolean; apply: (item: Item, other: Item, rng: Rng) => Item; makesNew?: boolean; carries?: boolean }
const ops: Op[] = [
  ...(Object.keys(CURRENCIES) as CurrencyId[]).map((c): Op => ({ name: c, can: (i) => CURRENCIES[c].can(i), apply: (i, _, r) => CURRENCIES[c].apply(i, r) })),
  { name: 'bench', can: (i) => benchOptions(i).length > 0, apply: (i, _, r) => applyBench(i, pick(r, benchOptions(i)), r) },
  { name: 'removeCrafted', can: removable, apply: removeCrafted },
  ...ESSENCES.map((e): Op => ({ name: `essence ${e}`, can: (i) => canEssence(i, e), apply: (i, _, r) => applyEssence(i, e, r) })),
  ...[1, 2, 3, 4].map((n): Op => {
    const set = (i: Item) => FOSSILS.filter((_, k) => (k * 7 + i.ilvl + i.explicits.length) % FOSSILS.length < n * 2).slice(0, n)
    return { name: `fossils x${n}`, can: (i) => canFossils(i, set(i)), apply: (i, _, r) => applyFossils(i, set(i), r) }
  }),
  { name: 'fossil Fractured', can: (i) => canFossils(i, ['Fractured Fossil']), apply: (i, _, r) => applyFossils(i, ['Fractured Fossil'], r) },
  { name: 'matron', can: (i) => matronOptions(i).length > 0, apply: (i, _, r) => applyMatron(i, r) },
  ...INFLUENCES.map((inf): Op => ({ name: `exalt ${inf}`, can: (i) => canInfluenceExalt(i, inf), apply: (i, _, r) => applyInfluenceExalt(i, inf, r) })),
  { name: 'dominance', can: canDominance, apply: (i, _, r) => applyDominance(i, r), carries: true },
  { name: 'awaken', can: (i, o) => canAwaken(o, i), apply: (i, o, r) => applyAwaken(o, i, r), carries: true },
  ...(['exarch', 'eater'] as Eldritch[]).flatMap((side) => [1, 2, 3, 4].map((t): Op => ({
    name: `eldritch ${side} ${t}`, can: (i) => canEldritchImplicit(i, side, t), apply: (i, _, r) => applyEldritchImplicit(i, side, t, r),
  }))),
  { name: 'eldritch chaos', can: canEldritchChaos, apply: (i, _, r) => applyEldritchChaos(i, r) },
  { name: 'eldritch exalt', can: canEldritchExalt, apply: (i, _, r) => applyEldritchExalt(i, r) },
  { name: 'eldritch annul', can: canEldritchAnnul, apply: (i, _, r) => applyEldritchAnnul(i, r) },
  { name: 'conflict', can: canConflict, apply: (i, _, r) => applyConflict(i, r) },
  ...HARVEST.map((h): Op => ({ name: `harvest ${h.id}`, can: (i) => h.can(i), apply: (i, _, r) => h.apply(i, r) })),
  ...BEAST_RECIPES.map((b): Op => ({ name: `beast ${b.id}`, can: (i) => b.can(i), apply: (i, _, r) => b.apply(i, r) })),
  { name: 'imprint', can: canImprint, apply: imprint },
  { name: 'restore', can: canRestore, apply: restore },
  { name: 'veiled chaos', can: canVeiledChaos, apply: (i, _, r) => applyVeiledChaos(i, r) },
  { name: 'veiled exalt', can: canVeiledExalt, apply: (i, _, r) => applyVeiledExalt(i, r) },
  { name: 'reveal', can: canReveal, apply: (i, _, r) => reveal(i, r) },
  {
    name: 'unveil', can: (i) => i.explicits.some((m) => m.unveil?.some((c) => canUnveil(i, c))),
    apply: (i, _, r) => unveil(i, pick(r, i.explicits.flatMap((m) => m.unveil ?? []).filter((c) => canUnveil(i, c))), r),
  },
  { name: 'recombine', can: (i, o) => canRecombine(i, o), apply: (i, o, r) => recombine(i, o, r), makesNew: true, carries: true },
]

const LEVEL = '아이템 레벨 '
const LIMIT = '접두/접미 한도 초과'
const family = (op: Op) => op.name.split(' ')[0]
const FAMILIES = [...new Set(ops.map(family))].map((f) => ops.filter((op) => family(op) === f))

// What every item must satisfy. Returns the broken rules.
function broken(item: Item): string[] {
  const out: string[] = []
  const groups = item.explicits.flatMap((m) => MODS[m.id].grp)
  const dup = groups.filter((g, k) => groups.indexOf(g) !== k)
  if (dup.length) out.push(`같은 옵션 그룹 두 개: ${dup.join(',')}`)
  const c = affixCounts(item)
  const l = affixLimits(item)
  if (c.prefix > l.prefix || c.suffix > l.suffix) out.push(`${LIMIT}: ${c.prefix}/${c.suffix} > ${l.prefix}/${l.suffix} (${item.rarity})`)
  const maxCrafted = metamods(item).multiCraft ? 3 : 1
  if (craftedCount(item) > maxCrafted) out.push(`제작 옵션 ${craftedCount(item)}개`)
  if (item.influences.length > 2 || new Set(item.influences).size !== item.influences.length) out.push(`영향력 ${item.influences.join(',')}`)
  if (item.influences.length && item.implicits.some((m) => eldritchSide(m))) out.push('영향력 아이템에 섬뜩한 고정 옵션')
  if (item.explicits.filter(isVeiled).length > 1) out.push('장막 옵션 두 개')
  const tags = itemTags({ ...item, explicits: [] })
  for (const m of item.explicits) {
    const d = MODS[m.id]
    const inf = modInfluence(m.id)
    const special = !!m.crafted || !!d.dom || !!d.essenceOnly || !!d.elev || ESSENCE_MODS.has(`${BASES[item.base].cls}|${m.id}`)
    if (inf && !item.influences.includes(inf)) out.push(`${inf} 옵션인데 영향력 없음: ${m.id}`)
    if (!special && spawnWeight(m.id, tags) <= 0) out.push(`이 베이스에 안 붙는 옵션: ${m.id} (${BASES[item.base].cls})`)
    if (m.values.length !== d.stats.length || d.stats.some(([, a, b], k) => m.values[k] < Math.min(a, b) || m.values[k] > Math.max(a, b))) out.push(`수치 범위 밖: ${m.id} ${m.values}`)
    if (!special && d.lvl > Math.max(item.ilvl, BEAST_LEVEL)) out.push(`${LEVEL}${item.ilvl}에 레벨 ${d.lvl} 옵션: ${m.id}`)
  }
  if (item.rarity === 'normal' && item.explicits.length) out.push('일반 아이템에 옵션')
  return out
}

const fracturedKey = (i: Item) => i.explicits.filter((m) => m.fractured).map((m) => `${m.id}:${m.values}`).sort().join('|')

test('모든 제작 무작위 연타: 매 단계 아이템이 게임 규칙을 지킴 (옵션 그룹·접두/접미 한도·분열·타락 등)', () => {
  const rng: Rng = { s: 2026 }
  const failures = new Map<string, { count: number; example: string }>()
  const fail = (op: string, why: string) => {
    const key = `${op} → ${why.replace(/: .*$/, '')}`
    const f = failures.get(key)
    if (f) f.count++
    else failures.set(key, { count: 1, example: why })
  }
  const used = new Map<string, number>()
  // Mostly plain bases; some influenced; some awakened armour full of influence mods, for the Orb of Dominance.
  const fresh = (): Item => {
    const r = next(rng)
    if (r < 0.15) {
      const infs = INFLUENCES.filter(() => next(rng) < 0.4).slice(0, 2)
      const both = infs.length === 2 ? infs : (['shaper', 'hunter'] as Influence[])
      let item: Item = { ...newItem(pick(rng, ARMOUR_IDS), 86, rng, both), rarity: 'rare' }
      for (let n = 0; n < 4; n++) item = addRandomMod(item, rng, { weight: (id) => (modInfluence(id) ? 1 : 0) }) ?? item
      return item
    }
    const inf: Influence[] = r < 0.4 ? [pick(rng, INFLUENCES)] : []
    return newItem(pick(rng, BASE_IDS), int(rng, 68, 86), rng, inf)
  }
  let pool = Array.from({ length: 40 }, fresh)
  for (let step = 0; step < 25_000; step++) {
    const k = int(rng, 0, pool.length - 1)
    const item = pool[k]
    const same = pool.filter((o) => o !== item && BASES[o.base].cls === BASES[item.base].cls)
    const other = same.length ? pick(rng, same) : fresh()
    // A few tries to find a craft that applies, like a player clicking around. Family first, so the 106 essences
    // don't crowd out the Orb of Dominance.
    let done = false
    for (let t = 0; t < 12 && !done; t++) {
      const op = pick(rng, pick(rng, FAMILIES))
      if (!op.can(item, other)) continue
      done = true
      used.set(family(op), (used.get(family(op)) ?? 0) + 1)
      if (item.corrupted || item.mirrored) fail(op.name, '타락·복제 아이템을 바꿈')
      const out = op.apply(item, other, rng)
      // Only what this craft broke (an item made by the recombinator answers for everything on it).
      const already = op.makesNew ? [] : broken(item)
      for (const why of broken(out)) {
        // Dominance has no level requirement, the Awakener keeps the donor's mod as it is, and the recombinator's
        // result level (average + 2) can sit below a mod it carried over (ponytail: taken as allowed).
        if (op.carries && why.startsWith(LEVEL)) continue
        // ponytail: a Vaal corruption implicit can replace a ring's prefix/suffix-limit implicit (Cogwork, Composite...).
        // Limits only gate adding mods and a corrupted item can't get more, so the mods already there stay.
        if (op.name === 'vaal' && out.corrupted && why.startsWith(LIMIT)) continue
        if (!already.includes(why)) fail(op.name, why)
      }
      if (!op.makesNew && !fracturedKey(out).startsWith(fracturedKey(item)) && fracturedKey(item)) {
        const before = fracturedKey(item).split('|')
        if (!before.every((x) => fracturedKey(out).split('|').includes(x))) fail(op.name, `분열 옵션이 사라지거나 바뀜: ${fracturedKey(item)} → ${fracturedKey(out)}`)
      }
      pool[k] = out
    }
    // Corrupted or long-crafted items make room for new ones.
    if (pool[k].corrupted || next(rng) < 0.01) pool[k] = fresh()
  }
  const report = [...failures].map(([key, f]) => `${key}: ${f.count}회 (예: ${f.example})`)
  assert.deepEqual(report, [], `\n${report.join('\n')}`)
  // Every family of crafts got exercised.
  for (const family of ['chaos', 'bench', 'essence', 'fossils', 'matron', 'exalt', 'dominance', 'awaken', 'eldritch', 'harvest', 'beast', 'veiled', 'unveil', 'recombine']) {
    assert.ok((used.get(family) ?? 0) > 20, `${family} ${used.get(family) ?? 0}회`)
  }
})
