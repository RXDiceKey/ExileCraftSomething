import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { MODS } from './data.ts'
import {
  applyConflict, applyEldritchAnnul, applyEldritchChaos, applyEldritchExalt, applyEldritchImplicit, canConflict,
  canEldritchAnnul, canEldritchChaos, canEldritchExalt, canEldritchImplicit, conflictChance, dominance, eldritchSide, eldritchTier,
} from './eldritch.ts'
import { canInfluenceExalt } from './influence.ts'
import { isPrefix, newItem, rollMod, type Item } from './item.ts'

const baseNames = (textEn as { bases: Record<string, string> }).bases
const baseId = (name: string) => Object.keys(baseNames).find((id) => baseNames[id] === name)!
const HELMET = baseId('Royal Burgonet')
const MASK = baseId('Penitent Mask') // has a fixed option of its own
const RING = baseId('Two-Stone Ring')
const lockOf = (stat: string) => Object.keys(MODS).find((id) => MODS[id].stats.some(([s]) => s === stat))!

const make = (base: string, ids: string[], o: Partial<Item> = {}): Item =>
  ({ ...newItem(base, 86, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })), ...o })
// An item with Searing Exarch tier x and Eater of Worlds tier y.
const withTiers = (item: Item, x: number, y: number): Item => {
  let i = item
  if (x) i = applyEldritchImplicit(i, 'exarch', Math.min(x, 4), { s: 7 })
  if (y) i = applyEldritchImplicit(i, 'eater', Math.min(y, 4), { s: 8 })
  // tiers 5-6 only come from Orbs of Conflict: swap in the same family's higher tier directly
  const bump = (side: 'exarch' | 'eater', t: number) => {
    i = { ...i, implicits: i.implicits.map((m) => {
      if (eldritchSide(m) !== side || MODS[m.id].et === t) return m
      const id = Object.keys(MODS).find((o) => MODS[o].gen === MODS[m.id].gen && MODS[o].type === MODS[m.id].type && MODS[o].et === t)!
      return rollMod(id, { s: 1 })
    }) }
  }
  if (x > 4) bump('exarch', x)
  if (y > 4) bump('eater', y)
  return i
}

test('불씨·영액: 갑옷류에 섬뜩한 고정 옵션, 다른 고정 옵션은 대체하고 반대쪽은 유지', () => {
  const mask = make(MASK, ['IncreasedLife10'])
  assert.equal(mask.implicits.length, 1)
  const a = applyEldritchImplicit(mask, 'exarch', 3, { s: 1 })
  assert.deepEqual(a.implicits.map(eldritchSide), ['exarch'], '가면의 원래 고정 옵션은 사라짐')
  assert.equal(eldritchTier(a, 'exarch'), 3)
  const b = applyEldritchImplicit(a, 'eater', 1, { s: 2 })
  assert.deepEqual(b.implicits.map(eldritchSide), ['exarch', 'eater'])
  const c = applyEldritchImplicit(b, 'exarch', 2, { s: 3 })
  assert.equal(eldritchTier(c, 'exarch'), 2, '같은 쪽은 새로 바뀜')
  assert.equal(c.implicits.find((m) => eldritchSide(m) === 'eater')!.id, b.implicits[1].id, '반대쪽은 그대로')
  assert.equal(c.explicits, mask.explicits, '접두어·접미어는 그대로')

  assert.ok(canEldritchImplicit(newItem(HELMET, 75, { s: 1 }), 'exarch', 1), '일반 아이템도 가능')
  assert.equal(canEldritchImplicit(newItem(HELMET, 74, { s: 1 }), 'exarch', 1), false, '아이템 레벨 75 미만')
  assert.equal(canEldritchImplicit(make(RING, []), 'exarch', 1), false, '갑옷·투구·장갑·장화만')
  assert.equal(canEldritchImplicit({ ...mask, influences: ['hunter'] }, 'eater', 1), false, '영향력 아이템 불가')
  assert.equal(canInfluenceExalt(a, 'hunter'), false, '섬뜩한 고정 옵션이 있으면 영향력 엑잘 불가')
})

test('우세: 등급이 높은 쪽, 같으면 없음', () => {
  const base = make(HELMET, ['IncreasedLife10'])
  assert.equal(dominance(withTiers(base, 3, 1)), 'exarch')
  assert.equal(dominance(withTiers(base, 2, 4)), 'eater')
  assert.equal(dominance(withTiers(base, 2, 0)), 'exarch', '한쪽만 있으면 그쪽')
  assert.equal(dominance(withTiers(base, 3, 3)), undefined)
  assert.equal(canEldritchChaos(withTiers(base, 3, 3)), false)
})

test('섬뜩한 카오스: 우세한 쪽만 다시 굴림, 접두어 변경 불가는 무시', () => {
  const prefixLock = lockOf('item_generation_cannot_change_prefixes')
  const item = withTiers(make(HELMET, ['IncreasedLife10', 'LocalIncreasedPhysicalDamageReductionRating5', 'FireResist7', 'ColdResist7']), 3, 1)
  item.explicits.push({ ...rollMod(prefixLock, { s: 1 }), crafted: true })
  const suffixes = item.explicits.filter((m) => !isPrefix(m))
  let changed = 0
  for (let s = 0; s < 200; s++) {
    const r = applyEldritchChaos(item, { s })
    assert.deepEqual(r.explicits.filter((m) => !isPrefix(m)), suffixes, '접미어(메타 속성 포함)는 그대로')
    assert.ok(r.explicits.some(isPrefix), '접두어 최소 1개')
    if (r.explicits.filter(isPrefix).map((m) => m.id).join() !== 'IncreasedLife10,LocalIncreasedPhysicalDamageReductionRating5') changed++
  }
  assert.ok(changed > 150, '잠긴 접두어도 바뀜')
})

test('섬뜩한 엑잘·소멸: 우세한 쪽에 추가/제거, 소멸은 메타 속성 잠금을 지킴', () => {
  const item = withTiers(make(HELMET, ['IncreasedLife10', 'FireResist7']), 1, 4)
  assert.equal(dominance(item), 'eater')
  for (let s = 0; s < 50; s++) {
    const r = applyEldritchExalt(item, { s })
    assert.equal(r.explicits.length, 3)
    assert.equal(isPrefix(r.explicits[2]), false, '세계 포식자 우세: 접미어 추가')
  }
  const full = withTiers(make(HELMET, ['IncreasedLife10', 'FireResist7', 'ColdResist7', 'LightningResist7']), 1, 4)
  assert.equal(canEldritchExalt(full), false, '접미어 칸이 꽉 참')
  const annulled = applyEldritchAnnul(full, { s: 3 })
  assert.equal(annulled.explicits.filter((m) => !isPrefix(m)).length, 2, '접미어 하나 제거')
  assert.ok(annulled.explicits.some((m) => m.id === 'IncreasedLife10'))
  const suffixLock = lockOf('item_generation_cannot_change_suffixes')
  const locked = withTiers(make(HELMET, ['FireResist7']), 1, 4)
  locked.explicits.push({ ...rollMod(suffixLock, { s: 1 }), crafted: true })
  assert.equal(canEldritchAnnul(locked), false, '접미어 변경 불가면 소멸 불가')
})

test('갈등의 오브: 같은 등급 50%, 2등급 앞서면 약 28%, 하급이 내려가면 사라짐', () => {
  const base = make(HELMET, ['IncreasedLife10'])
  assert.equal(conflictChance(withTiers(base, 3, 3)), 0.5)
  assert.ok(Math.abs(conflictChance(withTiers(base, 5, 3)) - 0.28) < 1e-9)
  assert.equal(conflictChance(withTiers(base, 6, 2)), 0, '완벽한(6)은 더 못 올림')
  assert.equal(canConflict(withTiers(base, 3, 0)), false, '두 쪽 다 있어야 함')

  const item = withTiers(base, 3, 3)
  let exUp = 0
  const N = 2000
  for (let s = 0; s < N; s++) {
    const r = applyConflict(item, { s })
    const x = eldritchTier(r, 'exarch')
    const y = eldritchTier(r, 'eater')
    assert.ok((x === 4 && y === 2) || (x === 2 && y === 4), `\${x}/\${y}`)
    if (x === 4) exUp++
  }
  assert.ok(Math.abs(exUp / N - 0.5) < 0.04, `\${exUp / N}`)
  const r = applyConflict(withTiers(base, 6, 1), { s: 1 })
  assert.equal(eldritchTier(r, 'eater'), 2)
  for (let s = 0; s < 200; s++) {
    const g = applyConflict(withTiers(base, 1, 4), { s })
    if (eldritchTier(g, 'eater') === 5) { assert.equal(eldritchTier(g, 'exarch'), 0, '하급이 내려가면 제거'); return }
  }
  assert.fail('세계 포식자 쪽이 오른 결과가 없음')
})
