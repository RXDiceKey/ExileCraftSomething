import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { applyBench, applyEssence, applyFossils, applyMatron, benchOptions, canEssence, canFossils, CRAFTING, matronOptions, removeCrafted } from './crafting.ts'
import { CURRENCIES, qualityStep } from './currency.ts'
import { BASES, MODS } from './data.ts'
import { affixCounts, newItem, rollMod, type Item } from './item.ts'

const baseNames = (textEn as { bases: Record<string, string> }).bases
const baseId = (name: string) => Object.keys(baseNames).find((id) => baseNames[id] === name)!
const REGALIA = baseId('Vaal Regalia')
const WAND = baseId('Convoking Wand')

const rare = (base: string, ids: string[]): Item =>
  ({ ...newItem(base, 86, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })) })
const benchIndex = (item: Item, statId: string) =>
  benchOptions(item).find((i) => MODS[CRAFTING.bench[i].mod].stats.some(([s]) => s === statId))!

test('작업대: 제작 속성 1개, 멀티는 3개, 제작 속성 제거', () => {
  const rng = { s: 3 }
  let item = rare(REGALIA, ['FireResist7'])
  const life = benchIndex(item, 'base_maximum_life')
  item = applyBench(item, life, rng)
  assert.equal(item.explicits.filter((m) => m.crafted).length, 1)
  assert.equal(benchOptions(item).length, 0, 'only one crafted mod without multimod')

  let multi = rare(REGALIA, ['FireResist7'])
  multi = applyBench(multi, benchIndex(multi, 'item_generation_can_have_multiple_crafted_mods'), rng)
  multi = applyBench(multi, benchIndex(multi, 'base_maximum_life'), rng)
  assert.ok(benchOptions(multi).length > 0, 'multimod leaves room for a third craft')
  assert.equal(removeCrafted(multi).explicits.length, 1)
})

test('메타 속성: "접두어 변경 불가"는 정제에도 남고, 소멸은 접미어만 제거', () => {
  const rng = { s: 4 }
  let item = rare(REGALIA, ['IncreasedLife10', 'LocalIncreasedEnergyShieldPercent8', 'FireResist7'])
  item = applyBench(item, benchIndex(item, 'item_generation_cannot_change_prefixes'), rng)
  const scoured = CURRENCIES.scouring.apply(item, rng)
  assert.deepEqual(scoured.explicits.map((m) => m.id), ['IncreasedLife10', 'LocalIncreasedEnergyShieldPercent8'])
  for (let k = 0; k < 50; k++) {
    const annulled = CURRENCIES.annulment.apply(item, { s: k })
    assert.equal(affixCounts(annulled).prefix, 2, 'prefixes are protected')
  }
})

test('메타 속성: "공격 속성 부여 불가"면 엑잘에서 공격 옵션 안 나옴', () => {
  let item = rare(WAND, ['SpellDamageAndManaOnWeapon6'])
  item = applyBench(item, benchIndex(item, 'item_generation_cannot_roll_attack_affixes'), { s: 5 })
  for (let k = 0; k < 300; k++) {
    const ex = CURRENCIES.exalted.apply(item, { s: k })
    assert.ok(!ex.explicits.some((m) => MODS[m.id].tags?.includes('attack')))
  }
})

test('에센스: 고정 옵션, 희귀 재조합은 절규 이상만, 낮은 등급은 옵션 레벨 상한', () => {
  const name = 'Deafening Essence of Greed' // life
  const forced = CRAFTING.essences[name].mods['Body Armour']
  let item = newItem(REGALIA, 86, { s: 6 })
  assert.ok(canEssence(item, name))
  for (let k = 0; k < 30; k++) {
    item = applyEssence(item, name, { s: k })
    assert.equal(item.rarity, 'rare')
    assert.ok(item.explicits.some((m) => m.id === forced))
  }
  // 낮은 등급 에센스: 일반 아이템에는 쓸 수 있지만 무작위 옵션 레벨이 mLvl로 제한, 희귀 재조합은 불가
  const low = Object.keys(CRAFTING.essences).find((n) => CRAFTING.essences[n].level === 1 && CRAFTING.essences[n].mods['Body Armour'])!
  const cap = CRAFTING.essences[low].ilvlMax!
  for (let k = 0; k < 30; k++) {
    const r = applyEssence(newItem(REGALIA, 86, { s: k }), low, { s: k })
    for (const m of r.explicits.slice(1)) assert.ok(MODS[m.id].lvl <= cap, `${low}: 레벨 ${MODS[m.id].lvl} > ${cap}`)
  }
  assert.equal(canEssence(rare(REGALIA, ['FireResist7']), low), false, '낮은 등급은 희귀 재조합 불가')
})

test('화석: 그을린 화석은 화염 많이, 냉기 없음', () => {
  const tagged = (item: Item, tag: string) => item.explicits.filter((m) => MODS[m.id].tags?.includes(tag)).length
  let fire = 0
  let baseline = 0
  for (let k = 0; k < 400; k++) {
    const fossiled = applyFossils(rare(WAND, []), ['Scorched Fossil'], { s: k })
    assert.equal(tagged(fossiled, 'cold'), 0)
    fire += tagged(fossiled, 'fire')
    baseline += tagged(CURRENCIES.chaos.apply(rare(WAND, ['SpellDamageAndManaOnWeapon6']), { s: k + 1e5 }), 'fire')
  }
  assert.ok(fire > baseline * 2, `fire mods ${fire} vs ${baseline} without fossil`)
})

test('분열: 분열된 옵션은 카오스·소멸에도 남음, 영향력 아이템은 분열 불가', () => {
  let item = rare(REGALIA, ['IncreasedLife10', 'FireResist7', 'ColdResist7', 'LightningResist7'])
  item = CURRENCIES.fracturing.apply(item, { s: 7 })
  const fractured = item.explicits.find((m) => m.fractured)!
  for (let k = 0; k < 50; k++) {
    assert.ok(CURRENCIES.chaos.apply(item, { s: k }).explicits.some((m) => m.id === fractured.id && m.fractured))
    assert.ok(CURRENCIES.annulment.apply(item, { s: k }).explicits.includes(fractured))
  }
  assert.equal(CURRENCIES.fracturing.can({ ...rare(REGALIA, ['IncreasedLife10', 'FireResist7', 'ColdResist7', 'LightningResist7']), influences: ['shaper'] }), false)
})

test('바알: 항상 타락, 약 절반은 변화 없음, 희귀 재련은 옵션 6개', () => {
  const item = rare(REGALIA, ['IncreasedLife10', 'FireResist7', 'ColdResist7', 'LightningResist7'])
  let same = 0
  for (let k = 0; k < 2000; k++) {
    const v = CURRENCIES.vaal.apply(item, { s: k })
    assert.equal(v.corrupted, true)
    if (v.explicits === item.explicits && v.implicits === item.implicits) same++
    else if (v.explicits !== item.explicits) assert.equal(v.explicits.length, 6, '희귀 재련은 항상 옵션 6개')
  }
  assert.ok(Math.abs(same / 2000 - 0.5) < 0.05, `${same / 2000}`)
  assert.equal(CURRENCIES.chaos.can(CURRENCIES.vaal.apply(item, { s: 1 })), false)
})

test('퀄리티: 숫돌은 무기, 고철은 방어구, 최대 20', () => {
  let wand = newItem(WAND, 86, { s: 1 })
  assert.equal(CURRENCIES.scrap.can(wand), false)
  while (CURRENCIES.whetstone.can(wand)) wand = CURRENCIES.whetstone.apply(wand, { s: 1 })
  assert.equal(wand.quality, 20)
  assert.equal(BASES[REGALIA].cls, 'Body Armour')
  assert.ok(CURRENCIES.scrap.can(newItem(REGALIA, 86, { s: 1 })))
})

test('메타 속성(위키 표): 카오스·변화는 잠긴 쪽을 지키고 빈 칸은 채울 수 있음, 신성은 잠긴 쪽 수치 유지', () => {
  let item = rare(REGALIA, ['IncreasedLife10', 'LocalIncreasedEnergyShieldPercent8', 'FireResist7'])
  item = applyBench(item, benchIndex(item, 'item_generation_cannot_change_prefixes'), { s: 10 })
  const prefixes = item.explicits.filter((m) => MODS[m.id].gen === 'prefix')
  for (let k = 0; k < 200; k++) {
    const c = CURRENCIES.chaos.apply(item, { s: k })
    for (const p of prefixes) assert.ok(c.explicits.includes(p), '접두어 유지')
    assert.ok(c.explicits.length >= 2 && affixCounts(c).prefix <= 3)
  }
  const d = CURRENCIES.divine.apply(item, { s: 11 })
  for (const p of prefixes) assert.ok(d.explicits.includes(p), '신성: 잠긴 접두어 수치 그대로')
})

test('메타 속성: 에센스·화석은 사용 불가 (멀티 제외)', () => {
  let item = rare(REGALIA, ['FireResist7'])
  assert.ok(canEssence(item, 'Deafening Essence of Greed'))
  const locked = applyBench(item, benchIndex(item, 'item_generation_cannot_change_suffixes'), { s: 12 })
  assert.equal(canEssence(locked, 'Deafening Essence of Greed'), false)
  assert.equal(canFossils(locked, ['Scorched Fossil']), false)
  item = applyBench(item, benchIndex(item, 'item_generation_can_have_multiple_crafted_mods'), { s: 13 })
  assert.ok(canEssence(item, 'Deafening Essence of Greed'), '멀티는 에센스 허용')
})

test('야생 털짐승 어미: 접미어를 다 채우고 접두어 한 칸만 남기면 "접미어 변경 불가" 확정', () => {
  const full = rare(REGALIA, ['IncreasedLife10', 'LocalIncreasedEnergyShieldPercent8', 'FireResist7', 'ColdResist7', 'LightningResist7'])
  const options = matronOptions(full)
  assert.equal(options.length, 1)
  assert.ok(MODS[options[0]].stats.some(([s]) => s === 'item_generation_cannot_change_suffixes'))
  const done = applyMatron(full, { s: 14 })
  assert.equal(done.explicits.at(-1)?.crafted, true)
  assert.equal(matronOptions(done).length, 0, '제작 속성이 생기면 더 못 씀')
  // 빈 칸이 넉넉하면 다섯 가지 중 무작위
  assert.ok(matronOptions(rare(REGALIA, ['IncreasedLife10'])).length >= 4)
})

test('퀄리티 증가량은 아이템 레벨로 정해짐 (3.25 이후): 11레벨 이하 20%, 84레벨 평균 약 1.52%, 95 이상 1%', () => {
  assert.equal(qualityStep(5, { s: 1 }), 20)
  assert.equal(qualityStep(99, { s: 1 }), 1)
  let sum = 0
  for (let s = 0; s < 4000; s++) {
    const q = qualityStep(84, { s })
    assert.ok(q === 1 || q === 2)
    sum += q
  }
  assert.ok(Math.abs(sum / 4000 - 1.524) < 0.03, `${sum / 4000}`)
  const armour = { ...newItem(REGALIA, 10, { s: 1 }), rarity: 'rare' as const }
  assert.equal(CURRENCIES.scrap.apply(armour, { s: 1 }).quality, 20, '희귀여도 낮은 레벨이면 한 번에 20%')
})
