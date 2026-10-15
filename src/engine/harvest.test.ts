import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { MODS } from './data.ts'
import { harvestCraft, HARVEST } from './harvest.ts'
import { modInfluence } from './influence.ts'
import { affixCounts, affixLimits, isPrefix, newItem, rollMod, type Item } from './item.ts'

const baseNames = (textEn as { bases: Record<string, string> }).bases
const baseId = (name: string) => Object.keys(baseNames).find((id) => baseNames[id] === name)!
const HELMET = baseId('Royal Burgonet')
const AXE = baseId('Runic Hatchet')
const lockOf = (stat: string) => Object.keys(MODS).find((id) => MODS[id].stats.some(([s]) => s === stat))!

const make = (base: string, ids: string[], o: Partial<Item> = {}): Item =>
  ({ ...newItem(base, 86, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })), ...o })
const legal = (i: Item) => {
  const c = affixCounts(i)
  const l = affixLimits(i)
  assert.ok(c.prefix <= l.prefix && c.suffix <= l.suffix)
  const g = i.explicits.flatMap((m) => MODS[m.id].grp)
  assert.equal(new Set(g).size, g.length)
}
const tagged = (tag: string) => (id: string) => (MODS[id].tags ?? []).includes(tag)

test('하베스트 [태그] 포함 재련: 그 태그 옵션이 반드시 하나, 접두어 변경 불가는 지킴', () => {
  const lock = lockOf('item_generation_cannot_change_prefixes')
  const item = make(HELMET, ['IncreasedLife10', 'LocalIncreasedPhysicalDamageReductionRating5', 'FireResist7'])
  item.explicits.push({ ...rollMod(lock, { s: 1 }), crafted: true })
  const c = harvestCraft('ReforgeChaos')
  assert.ok(c.can(item))
  for (let s = 0; s < 200; s++) {
    const r = c.apply(item, { s })
    assert.ok(r.explicits.some((m) => tagged('chaos')(m.id)), '카오스 옵션 보장')
    assert.deepEqual(r.explicits.filter(isPrefix).map((m) => m.id).slice(0, 2), ['IncreasedLife10', 'LocalIncreasedPhysicalDamageReductionRating5'])
    legal(r)
  }
  assert.equal(c.can({ ...item, rarity: 'magic' }), false, '희귀만')
})

test('하베스트 같은 종류 더 나오게: 있던 옵션이 훨씬 자주, 옵션 수는 줄지 않음', () => {
  const item = make(HELMET, ['IncreasedLife10', 'LocalIncreasedPhysicalDamageReductionRating5', 'FireResist7', 'ColdResist7', 'LightningResist7'])
  const groups = new Set(item.explicits.flatMap((m) => MODS[m.id].grp))
  const share = (more: boolean) => {
    let same = 0, all = 0
    for (let s = 0; s < 300; s++) {
      const r = harvestCraft(more ? 'ReforgeMoreLikely' : 'ReforgeLessLikely').apply(item, { s })
      if (more) assert.ok(r.explicits.length >= 5, '원래 5개보다 줄지 않음')
      for (const m of r.explicits) { all++; if (MODS[m.id].grp.some((g) => groups.has(g))) same++ }
    }
    return same / all
  }
  const more = share(true)
  const less = share(false)
  assert.ok(more > 0.8, `더 나오게 ${more}`)
  assert.ok(less < 0.1, `덜 나오게 ${less}`)
})

test('하베스트 저항·피해 종류 변경: 같은 등급의 다른 원소로', () => {
  const ring = make(HELMET, ['IncreasedLife10', 'ColdResist7'])
  const toFire = harvestCraft('ChangeColdToFireResist')
  assert.ok(toFire.can(ring))
  const r = toFire.apply(ring, { s: 1 })
  assert.equal(r.explicits[1].id, 'FireResist7', '냉기 저항 7 -> 화염 저항 7 (같은 등급)')
  assert.equal(r.explicits[0], ring.explicits[0], '다른 옵션은 그대로')
  assert.equal(harvestCraft('ChangeFireToLightningResist').can(ring), false, '화염 저항이 없음')

  const axe = make(AXE, ['LocalAddedColdDamage5', 'IncreasedLife10'].filter((id) => MODS[id]))
  const dmg = harvestCraft('ChangeColdToLightningDamage').apply(axe, { s: 1 })
  assert.equal(MODS[dmg.explicits[0].id].type, 'LocalLightningDamage')
  assert.equal(harvestCraft('ChangeColdToFireResist').can(axe), false, '피해 옵션은 저항 변경 대상 아님')
})

test('하베스트 영향력 무작위 변경 + 재련, 영향력 옵션 포함 재련', () => {
  const item = make(HELMET, ['AreaDamageSupportedUber3', 'IncreasedLife10'], { influences: ['elder'] })
  const seen = new Set<string>()
  for (let s = 0; s < 100; s++) {
    const r = harvestCraft('RerollInfluenceType').apply(item, { s })
    assert.equal(r.influences.length, 1)
    seen.add(r.influences[0])
    legal(r)
  }
  assert.equal(seen.size, 6, '여섯 영향력 모두 나옴')
  assert.equal(harvestCraft('RerollInfluenceType').can({ ...item, influences: [] }), false)
  for (let s = 0; s < 100; s++) {
    const r = harvestCraft('BossInfluence1').apply(item, { s })
    assert.ok(r.explicits.some((m) => modInfluence(m.id) === 'elder'), '엘더 옵션 보장')
  }
})

test('하베스트 [태그] 옵션 추가 + 다른 옵션 제거: 꽉 찬 아이템에도, 영향력 아이템 불가', () => {
  const full = make(HELMET, ['IncreasedLife10', 'LocalIncreasedPhysicalDamageReductionRating5', 'LocalBaseArmourAndLife4', 'FireResist7', 'ColdResist7', 'LightningResist7'])
  const c = harvestCraft('AugmentChaos')
  assert.ok(c.can(full))
  for (let s = 0; s < 100; s++) {
    const r = c.apply(full, { s })
    assert.equal(r.explicits.length, 6)
    assert.ok(r.explicits.some((m) => tagged('chaos')(m.id)))
    legal(r)
  }
  assert.equal(c.can({ ...full, influences: ['hunter'] }), false)
  // 접미어 변경 불가(작업대 옵션 자체는 접두어 칸): 접미어는 지워지지 않음
  const lock = lockOf('item_generation_cannot_change_suffixes')
  const locked = make(HELMET, ['IncreasedLife10', 'FireResist7', 'ColdResist7'])
  locked.explicits.push({ ...rollMod(lock, { s: 1 }), crafted: true })
  for (let s = 0; s < 100; s++) {
    const ids = c.apply(locked, { s }).explicits.map((m) => m.id)
    assert.ok(ids.includes('FireResist7') && ids.includes('ColdResist7'), '접미어 유지')
  }
  assert.ok(HARVEST.length >= 40)
})
