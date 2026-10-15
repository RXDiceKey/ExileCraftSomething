import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { tierOf } from '../game/describe.ts'
import { MODS } from './data.ts'
import { isInfluenced } from './influence.ts'
import { affixCounts, affixLimits, isPrefix, itemTags, newItem, rollMod, spawnWeight, type Item } from './item.ts'
import { canRecombine, recombine, recombineCostChaos, recombinedLevel } from './recombinator.ts'

const baseNames = (textEn as { bases: Record<string, string> }).bases
const baseId = (name: string) => Object.keys(baseNames).find((id) => baseNames[id] === name)!
const HELMET = baseId('Royal Burgonet')
const MASK = baseId('Penitent Mask')
const RING = baseId('Two-Stone Ring')
const make = (base: string, ids: string[], o: Partial<Item> = {}): Item =>
  ({ ...newItem(base, 86, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })), ...o })
// n mods of one side that really roll on this base, each from a different mod group
function valid(base: string, gen: string, n: number, skip: string[] = []): string[] {
  const tags = itemTags(newItem(base, 86, { s: 1 }))
  const out: string[] = []
  for (const id of Object.keys(MODS)) {
    const m = MODS[id]
    if (m.gen !== gen || m.dom || m.lvl > 86 || spawnWeight(id, tags) <= 0 || skip.includes(id)) continue
    if ([...out, ...skip].some((x) => MODS[x].grp.some((g) => m.grp.includes(g)))) continue
    out.push(id)
    if (out.length === n) break
  }
  return out
}
const legal = (i: Item) => {
  const c = affixCounts(i)
  const l = affixLimits(i)
  assert.ok(c.prefix <= l.prefix && c.suffix <= l.suffix)
  const g = i.explicits.flatMap((m) => MODS[m.id].grp)
  assert.equal(new Set(g).size, g.length)
}

test('재조합기: 같은 클래스 마법·희귀 2개, 결과 아이템 레벨 = min(평균+2, 높은 쪽), 베이스는 반반', () => {
  const a = make(HELMET, ['IncreasedLife10', 'FireResist7'], { ilvl: 84 })
  const b = make(MASK, ['ColdResist7', 'LocalIncreasedPhysicalDamageReductionRating5'], { ilvl: 75 })
  assert.ok(canRecombine(a, b))
  assert.equal(canRecombine(a, make(RING, ['FireResist7'])), false, '다른 아이템 클래스')
  assert.equal(canRecombine(a, { ...b, corrupted: true }), false, '타락 불가')
  assert.equal(canRecombine(a, { ...b, rarity: 'normal', explicits: [] }), false, '일반 아이템 불가')
  assert.equal(recombinedLevel(84, 75), 81)
  assert.equal(recombinedLevel(84, 83), 84)
  const ids = new Set([...a.explicits, ...b.explicits].map((m) => m.id))
  let helm = 0
  for (let s = 0; s < 400; s++) {
    const r = recombine(a, b, { s })
    assert.equal(r.ilvl, 81)
    if (r.base === HELMET) helm++
    assert.ok(r.explicits.length >= 1, '빈 결과 없음')
    for (const m of r.explicits) assert.ok(ids.has(m.id))
    legal(r)
  }
  assert.ok(Math.abs(helm / 400 - 0.5) < 0.08)
})

test('재조합기: 접두어 1개 + 접미어 1개면 접두어만/접미어만/둘 다 각 1/3', () => {
  const a = make(HELMET, valid(HELMET, 'prefix', 1), { rarity: 'magic' })
  const b = make(HELMET, valid(HELMET, 'suffix', 1), { rarity: 'magic' })
  const n = { p: 0, s: 0, ps: 0 }
  for (let s = 0; s < 3000; s++) {
    const c = affixCounts(recombine(a, b, { s }))
    if (c.prefix && c.suffix) n.ps++
    else if (c.prefix) n.p++
    else n.s++
  }
  for (const v of Object.values(n)) assert.ok(Math.abs(v / 3000 - 1 / 3) < 0.04, JSON.stringify(n))
})

test('재조합기: 접두어 풀 6개면 2개 28%, 3개 72%', () => {
  // 투구에 실제로 붙는, 서로 다른 그룹 접두어 6개를 두 아이템에 나눠 넣음
  const picked = valid(HELMET, 'prefix', 6)
  assert.equal(picked.length, 6)
  const x = make(HELMET, picked.slice(0, 3))
  const y = make(HELMET, picked.slice(3))
  const n: Record<number, number> = {}
  for (let s = 0; s < 3000; s++) { const k = affixCounts(recombine(x, y, { s })).prefix; n[k] = (n[k] ?? 0) + 1 }
  assert.ok(Math.abs((n[3] ?? 0) / 3000 - 0.72) < 0.04, JSON.stringify(n))
  assert.ok(Math.abs((n[2] ?? 0) / 3000 - 0.28) < 0.04, JSON.stringify(n))
})

test('재조합기: 배타 옵션(작업대 등)은 결과에 하나만, 영향력 옵션은 영향력 없는 베이스로 못 감', () => {
  const benchPrefix = Object.keys(MODS).find((id) => MODS[id].dom === 'crafted' && MODS[id].gen === 'prefix' && MODS[id].stats[0][0] === 'base_maximum_life')
  const benchSuffix = Object.keys(MODS).find((id) => MODS[id].dom === 'crafted' && MODS[id].gen === 'suffix' && MODS[id].stats[0][0] === 'base_cold_damage_resistance_%')
  if (benchPrefix && benchSuffix) {
    const a = make(HELMET, ['FireResist7'])
    a.explicits.push({ ...rollMod(benchPrefix, { s: 1 }), crafted: true })
    const b = make(HELMET, ['LocalIncreasedPhysicalDamageReductionRating5'])
    b.explicits.push({ ...rollMod(benchSuffix, { s: 1 }), crafted: true })
    for (let s = 0; s < 300; s++) assert.ok(recombine(a, b, { s }).explicits.filter((m) => m.crafted).length <= 1)
  }
  const elder = make(HELMET, ['AreaDamageSupportedUber3', 'FireResist7'], { influences: ['elder'] })
  const plain = make(HELMET, ['IncreasedLife10', 'ColdResist7'])
  for (let s = 0; s < 300; s++) {
    const r = recombine(elder, plain, { s })
    if (!r.influences.length) assert.ok(!r.explicits.some((m) => isInfluenced(m.id)), '영향력 없는 베이스엔 영향력 옵션 없음')
  }
})

test('재조합기·마법 아이템: 접두어를 못 갖는 반지(미늘톱니 반지 0/6)엔 접두어가 안 붙음', () => {
  const RATCHET = baseId('Ratcheting Ring')
  assert.deepEqual(affixLimits({ ...newItem(RATCHET, 86, { s: 1 }), rarity: 'magic' }), { prefix: 0, suffix: 1 })
  const a = make(RING, ['IncreasedLife7', 'IncreasedMana10', 'FireResist7', 'ColdResist7'])
  const b = make(RATCHET, ['Dexterity8', 'ChaosResist5', 'LightningResist7'])
  for (let s = 0; s < 300; s++) {
    const r = recombine(a, b, { s })
    legal(r)
    if (r.base === RATCHET) assert.equal(r.explicits.filter(isPrefix).length, 0)
  }
})

test('재조합기 비용: 몇 카오스 수준, 고등급일수록 비싸고 저등급을 섞으면 쌈', () => {
  const top = make(HELMET, ['IncreasedLife10', 'FireResist8'].filter((id) => MODS[id]))
  const low = make(HELMET, ['IncreasedLife1', 'FireResist1'].filter((id) => MODS[id]))
  const hi = recombineCostChaos(top, top, tierOf)
  const mixed = recombineCostChaos(top, low, tierOf)
  assert.ok(hi > mixed, `${hi} > ${mixed}`)
  assert.ok(hi <= 30 && mixed >= 3)
  assert.ok(isPrefix(top.explicits[0]))
})

test('재조합기 분열 옵션: 분열 베이스가 뽑혀야만 남고, 남아도 같거나 줄어듦 (다른 쪽 분열 옵션은 안 넘어옴)', () => {
  const [p1, p2] = valid(HELMET, 'prefix', 2)
  const [s1, s2] = valid(HELMET, 'suffix', 2)
  const a = make(HELMET, [p1, s1])
  const fa = { ...a, explicits: a.explicits.map((m, k) => (k === 0 ? { ...m, fractured: true as const } : m)) }
  const b = make(HELMET, [p2, s2])
  const fb = { ...b, explicits: b.explicits.map((m, k) => (k === 1 ? { ...m, fractured: true as const } : m)) }
  let kept = 0
  let lost = 0
  for (let s = 0; s < 400; s++) {
    const r = recombine(fa, fb, { s })
    legal(r)
    const fr = r.explicits.filter((m) => m.fractured)
    assert.ok(fr.length <= 1, '분열 옵션이 늘지 않음')
    for (const m of fr) assert.ok(m === fa.explicits[0] || m === fb.explicits[1], '분열 옵션은 수치까지 그대로')
    if (fr.length) kept++
    else lost++
  }
  assert.ok(kept > 100 && lost > 100, `남음 ${kept}, 사라짐 ${lost}`)
  for (let s = 0; s < 100; s++) for (const m of recombine(fa, b, { s }).explicits) if (m.fractured) assert.equal(m, fa.explicits[0])
})
