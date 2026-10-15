import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { CURRENCIES } from './currency.ts'
import { MODS } from './data.ts'
import { applyAwaken, applyDominance, applyInfluenceExalt, canAwaken, canDominance, canInfluenceExalt, isInfluenced, modInfluence } from './influence.ts'
import { affixCounts, affixLimits, newItem, rollMod, type Item } from './item.ts'
import { tierOf } from '../game/describe.ts'

const baseNames = (textEn as { bases: Record<string, string> }).bases
const baseId = (name: string) => Object.keys(baseNames).find((id) => baseNames[id] === name)!
const HELMET = baseId('Royal Burgonet')
const RING = baseId('Two-Stone Ring')

const make = (base: string, ids: string[], o: Partial<Item> = {}): Item =>
  ({ ...newItem(base, 86, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })), ...o })
const legal = (i: Item) => {
  const c = affixCounts(i)
  const l = affixLimits(i)
  assert.ok(c.prefix <= l.prefix && c.suffix <= l.suffix, '접두어/접미어 개수 한도')
  const groups = i.explicits.flatMap((m) => MODS[m.id].grp)
  assert.equal(new Set(groups).size, groups.length, '같은 옵션 그룹은 하나만')
}

test('영향력 엑잘: 영향력 없는 희귀 아이템에 영향력 + 그 영향력 옵션 하나', () => {
  const item = make(HELMET, ['IncreasedLife10', 'FireResist7'])
  for (let s = 0; s < 200; s++) {
    const r = applyInfluenceExalt(item, 'elder', { s })
    assert.deepEqual(r.influences, ['elder'])
    assert.equal(r.explicits.length, 3)
    assert.equal(modInfluence(r.explicits[2].id), 'elder')
    legal(r)
  }
  assert.ok(canInfluenceExalt(item, 'hunter'))
  assert.equal(canInfluenceExalt({ ...item, influences: ['shaper'] }, 'hunter'), false, '이미 영향력 있음')
  assert.equal(canInfluenceExalt({ ...item, rarity: 'magic' }, 'hunter'), false, '희귀만')
  assert.equal(canInfluenceExalt(CURRENCIES.fracturing.apply(make(HELMET, ['IncreasedLife10', 'FireResist7', 'ColdResist7', 'LightningResist7']), { s: 3 }), 'hunter'), false, '분열 아이템 불가')
  assert.equal(canInfluenceExalt({ ...item, ilvl: 60 }, 'elder'), false, '영향력 옵션 최소 아이템 레벨(68) 미달')
  const full = make(HELMET, ['IncreasedLife10', 'LocalIncreasedPhysicalDamageReductionRating5', 'LocalBaseArmourAndLife4', 'FireResist7', 'ColdResist7', 'LightningResist7'])
  assert.equal(canInfluenceExalt(full, 'elder'), false, '빈 칸이 없으면 불가')
})

test('각성자의 오브: 양쪽 영향력 옵션 하나씩 유지, 영향력 둘, 나머지 재련', () => {
  const donor = make(HELMET, ['AreaDamageSupportedUber3', 'IncreasedLife10'], { influences: ['elder'] })
  const target = make(HELMET, ['SpellAddedFireDamageInfluence3_', 'ColdResist7'], { influences: ['hunter'], ilvl: 84, quality: 20 })
  assert.ok(canAwaken(donor, target))
  for (let s = 0; s < 200; s++) {
    const r = applyAwaken(donor, target, { s })
    assert.deepEqual(r.influences, ['elder', 'hunter'], '표시 순서: 쉐이퍼 > 엘더 > 십자군 > 대속자 > 사냥꾼 > 전쟁군주')
    assert.equal(r.rarity, 'rare')
    assert.equal(r.base, target.base)
    assert.equal(r.ilvl, 84)
    assert.equal(r.quality, 20)
    const ids = r.explicits.map((m) => m.id)
    assert.ok(ids.includes('AreaDamageSupportedUber3') && ids.includes('SpellAddedFireDamageInfluence3_'), '등급 그대로 유지')
    assert.ok(r.explicits.length >= 4 && r.explicits.length <= 6)
    legal(r)
  }
  assert.equal(canAwaken(donor, { ...target, influences: ['elder'] }), false, '같은 영향력')
  assert.equal(canAwaken(donor, { ...target, influences: ['hunter', 'shaper'] }), false, '영향력은 정확히 하나씩')
  assert.equal(canAwaken(donor, make(RING, [], { influences: ['hunter'] })), false, '같은 아이템 클래스만')
  assert.equal(canAwaken(donor, { ...target, corrupted: true }), false, '타락 불가')
})

test('각성자의 오브: 분열 아이템에는 못 씀 (기증·대상 둘 다)', () => {
  const target = make(HELMET, ['IncreasedLife10'], { influences: ['shaper'] })
  const donor = make(HELMET, ['FireResist7'], { influences: ['elder'] })
  assert.ok(canAwaken(donor, target))
  const broken = { ...target, explicits: [{ ...target.explicits[0], fractured: true as const }] }
  assert.equal(canAwaken(donor, broken), false)
  assert.equal(canAwaken({ ...donor, explicits: [{ ...donor.explicits[0], fractured: true as const }] }, target), false)
})

test('각성자의 오브: 남길 두 옵션이 같은 옵션 그룹이면 하나만, 메타 속성은 무시', () => {
  const lock = Object.keys(MODS).find((id) => MODS[id].stats.some(([s]) => s === 'item_generation_cannot_change_suffixes'))!
  const donor = make(HELMET, ['AreaDamageSupportedUber3'], { influences: ['elder'] })
  const sameGroup = Object.keys(MODS).find((id) => id !== 'AreaDamageSupportedUber3' && modInfluence(id) === 'shaper'
    && MODS[id].grp.some((g) => MODS.AreaDamageSupportedUber3.grp.includes(g)) && MODS[id].spawn.some(([t]) => t === 'helmet_shaper'))
  if (sameGroup) {
    const target = make(HELMET, [sameGroup], { influences: ['shaper'] })
    for (let s = 0; s < 50; s++) legal(applyAwaken(donor, target, { s }))
  }
  const locked = make(HELMET, ['SpellAddedFireDamageInfluence3_', 'ColdResist7'], { influences: ['hunter'] })
  locked.explicits.push({ ...rollMod(lock, { s: 1 }), crafted: true })
  for (let s = 0; s < 50; s++) {
    const r = applyAwaken(donor, locked, { s })
    assert.ok(!r.explicits.some((m) => m.id === lock || m.crafted), '제작 속성·메타 속성은 사라짐')
  }
})

test('지배의 오브: 영향력 옵션 하나 등급 상승, 다른 하나 제거, 1등급은 고양됨', () => {
  const item = make(HELMET, ['AreaDamageSupportedUber2_', 'IncreasedBurningDamageSupportedUber3', 'IncreasedLife10'], { influences: ['elder'] })
  assert.ok(canDominance(item))
  const seen = new Set<string>()
  for (let s = 0; s < 200; s++) {
    const r = applyDominance(item, { s })
    const inf = r.explicits.filter((m) => isInfluenced(m.id)).map((m) => m.id)
    assert.equal(inf.length, 1, '영향력 옵션 하나는 제거')
    assert.ok(r.explicits.some((m) => m.id === 'IncreasedLife10'), '일반 옵션은 그대로')
    seen.add(inf[0])
  }
  // 2등급 -> 1등급, 1등급 -> 고양된 옵션
  assert.deepEqual([...seen].sort(), ['AreaDamageSupportedUber3', 'IncreasedBurningDamageSupportedUberMaven'])
  assert.equal(MODS.IncreasedBurningDamageSupportedUberMaven.elev, 'BurningDamageSupported')

  const elevated = make(HELMET, ['AreaDamageSupportedUberMaven', 'IncreasedBurningDamageSupportedUberMaven'], { influences: ['elder'] })
  const r = applyDominance(elevated, { s: 5 })
  assert.equal(r.explicits.length, 1)
  assert.ok(MODS[r.explicits[0].id].elev, '고양된 옵션을 고르면 수치만 다시 굴림')

  // 같은 계열의 고양된 옵션이 영향력마다 따로 있음: 사냥꾼 옵션은 "고양된 사냥꾼의"로
  const dual = make(HELMET, ['SpellAddedLightningDamageInfluence3', 'AreaDamageSupportedUber3'], { influences: ['elder', 'hunter'] })
  for (let s = 0; s < 40; s++) {
    const [m] = applyDominance(dual, { s }).explicits
    assert.ok(MODS[m.id].elev)
    assert.equal(modInfluence(m.id), m.id.startsWith('SpellAdded') ? 'hunter' : 'elder', m.id)
  }

  assert.equal(canDominance(make(HELMET, ['AreaDamageSupportedUber2_', 'IncreasedLife10'], { influences: ['elder'] })), false, '영향력 옵션 2개 이상')
  assert.equal(canDominance(make(RING, [], { influences: ['elder'] })), false, '갑옷·투구·장갑·장화만')
})

test('영향력 둘이 같은 옵션 계열을 써도 등급·등급 상승은 영향력별로', () => {
  // 투구의 주문 번개 피해 추가: 쉐이퍼(68/75/84)와 사냥꾼(68/70/75)이 같은 계열
  const item = make(HELMET, ['SpellAddedLightningDamageInfluence2', 'IncreasedLife10', 'AreaDamageSupportedUber3'], { influences: ['shaper', 'hunter'] })
  assert.equal(tierOf(item, 'SpellAddedLightningDamageInfluence2'), 2)
  assert.equal(tierOf(item, 'SpellAddedLightningDamageUber1'), 3)
  const dual = make(HELMET, ['SpellAddedLightningDamageInfluence2', 'SpellAddedColdDamageUber1'], { influences: ['shaper', 'hunter'] })
  for (let s = 0; s < 40; s++) {
    const [m] = applyDominance(dual, { s }).explicits
    assert.ok(['SpellAddedLightningDamageInfluence3', 'SpellAddedColdDamageUber2'].includes(m.id), m.id)
  }
})
