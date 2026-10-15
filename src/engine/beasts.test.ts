import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { beastRecipe, BEAST_RECIPES, canImprint, canRestore, imprint, restore } from './beasts.ts'
import { CURRENCIES } from './currency.ts'
import { MODS } from './data.ts'
import { modInfluence } from './influence.ts'
import { affixCounts, isPrefix, newItem, rollMod, type Item } from './item.ts'

const baseNames = (textEn as { bases: Record<string, string> }).bases
const baseId = (name: string) => Object.keys(baseNames).find((id) => baseNames[id] === name)!
const HELMET = baseId('Royal Burgonet')
const AXE = baseId('Runic Hatchet')
const lockOf = (stat: string) => Object.keys(MODS).find((id) => MODS[id].stats.some(([s]) => s === stat) && MODS[id].dom === 'crafted')!

const make = (base: string, ids: string[], o: Partial<Item> = {}): Item =>
  ({ ...newItem(base, 86, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })), ...o })

test('각인: 마법 아이템을 저장했다가 제왕 실패 후 되돌림, 분열·타락 불가', () => {
  const magic = make(HELMET, ['IncreasedLife10', 'FireResist7'], { rarity: 'magic' })
  assert.ok(canImprint(magic))
  assert.equal(canImprint({ ...magic, rarity: 'rare' }), false, '마법 아이템만')
  const saved = imprint(magic)
  const regal = CURRENCIES.regal.apply(saved, { s: 3 })
  assert.equal(regal.rarity, 'rare')
  assert.ok(canRestore(regal), '각인은 아이템을 따라감')
  const back = restore(regal)
  assert.deepEqual(back, magic, '각인 당시 그대로, 각인은 사라짐')
  assert.equal(canRestore(back), false)
  assert.equal(canRestore({ ...regal, corrupted: true }), false, '타락하면 불가')
  const fractured = { ...regal, explicits: regal.explicits.map((m, i) => (i === 0 ? { ...m, fractured: true as const } : m)) }
  assert.equal(canRestore(fractured), false, '분열되면 불가')
})

test('접두어 추가·접미어 제거 야수: 희귀만, 접미어 변경 불가면 제거 없이 추가', () => {
  const r = beastRecipe('EinharMasterCraft31')
  const item = make(HELMET, ['IncreasedLife10', 'FireResist7', 'ColdResist7'])
  for (let s = 0; s < 50; s++) {
    const out = r.apply(item, { s })
    assert.deepEqual(affixCounts(out), { prefix: 2, suffix: 1 })
    assert.equal(out.ilvl, 86, '아이템 레벨은 그대로')
  }
  assert.equal(r.can({ ...item, rarity: 'magic' }), false)
  const full = make(HELMET, ['IncreasedLife10', 'LocalIncreasedPhysicalDamageReductionRating5', 'LocalBaseArmourAndLife4', 'FireResist7'])
  assert.equal(r.can(full), false, '접두어 칸이 없음')
  const lock = lockOf('item_generation_cannot_change_suffixes') // 이 작업대 옵션 자체는 접두어 칸
  const locked = make(HELMET, ['FireResist7', 'ColdResist7'])
  locked.explicits.push({ ...rollMod(lock, { s: 1 }), crafted: true })
  const out = r.apply(locked, { s: 4 })
  assert.deepEqual(affixCounts(out), { prefix: 2, suffix: 2 }, '접미어는 그대로, 접두어만 추가')
})

test('접미어 추가·접두어 제거 야수: 공격 속성 부여 불가 메타 속성을 무시', () => {
  const r = beastRecipe('EinharMasterCraft30')
  const noAttack = lockOf('item_generation_cannot_roll_attack_affixes')
  const axe = make(AXE, ['IncreasedLife10'].filter((id) => MODS[id]))
  axe.explicits = [rollMod(Object.keys(MODS).find((id) => MODS[id].type === 'LocalPhysicalDamagePercent' && MODS[id].gen === 'prefix')!, { s: 1 })]
  axe.explicits.push({ ...rollMod(noAttack, { s: 1 }), crafted: true })
  let attack = 0
  for (let s = 0; s < 200; s++) {
    const out = r.apply(axe, { s })
    const added = out.explicits.filter((m) => !isPrefix(m) && !m.crafted)
    if (added.some((m) => (MODS[m.id].tags ?? []).includes('attack'))) attack++
  }
  assert.ok(attack > 0, '공격 접미어도 나옴')
})

test('영향력 아이템에 속성 부여 야수, 위상 스킬 야수', () => {
  const hunter = make(HELMET, ['IncreasedLife10'], { influences: ['hunter'] })
  const r = beastRecipe('EinharMasterCraft45')
  assert.ok(r.can(hunter))
  assert.equal(r.can(make(HELMET, ['IncreasedLife10'])), false, '사냥꾼 아이템만')
  for (let s = 0; s < 30; s++) assert.equal(modInfluence(r.apply(hunter, { s }).explicits[1].id), 'hunter')

  const cat = beastRecipe('EinharMasterCraft38')
  const item = make(HELMET, ['IncreasedLife10', 'FireResist7'])
  const out = cat.apply(item, { s: 1 })
  assert.equal(out.explicits[2].id, 'GrantsCatAspectCrafted')
  assert.equal(out.explicits[2].crafted, true)
  assert.equal(cat.can(out), false, '제작 속성은 하나만')
  assert.equal(beastRecipe('EinharMasterCraft39').can(out), false, '위상은 하나만')
  assert.equal(BEAST_RECIPES.length, 12, '접두/접미 2 + 영향력 6 + 위상 4')
})
