import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { CURRENCIES, type CurrencyId } from './currency.ts'
import { MODS } from './data.ts'
import { affixCounts, affixLimits, itemTags, newItem, spawnWeight, type Item } from './item.ts'
import type { Rng } from './rng.ts'

const baseNames = (textEn as { bases: Record<string, string> }).bases
const baseId = (name: string) => Object.keys(baseNames).find((id) => baseNames[id] === name)!
const REGALIA = baseId('Vaal Regalia')
const SIMPLEX = baseId('Simplex Amulet')
const LICH = baseId("Lich's Circlet")

const use = (c: CurrencyId, item: Item, rng: Rng) => {
  assert.ok(CURRENCIES[c].can(item), `${c} should apply`)
  return CURRENCIES[c].apply(item, rng)
}

// Every rolled item must obey PoE's rules; checked after every operation in these tests.
function assertLegal(item: Item) {
  const c = affixCounts(item)
  const l = affixLimits(item)
  assert.ok(c.prefix <= l.prefix && c.suffix <= l.suffix, 'affix limits')
  const groups = item.explicits.flatMap((m) => MODS[m.id].grp)
  assert.equal(new Set(groups).size, groups.length, 'one mod per group')
  const tags = itemTags({ ...item, explicits: [] })
  for (const m of item.explicits) {
    assert.ok(MODS[m.id].lvl <= item.ilvl, `${m.id} needs ilvl ${MODS[m.id].lvl}`)
    assert.ok(spawnWeight(m.id, tags) > 0, `${m.id} can't roll here`)
    MODS[m.id].stats.forEach(([, a, b], i) => assert.ok(m.values[i] >= Math.min(a, b) && m.values[i] <= Math.max(a, b)))
  }
}

test('같은 시드면 같은 결과', () => {
  const roll = () => use('alchemy', newItem(REGALIA, 86, { s: 7 }), { s: 42 })
  assert.deepEqual(roll(), roll())
})

test('카오스: 옵션 4/5/6개가 약 8:3:1, 항상 규칙 준수', () => {
  const rng = { s: 1 }
  let item = use('alchemy', newItem(REGALIA, 86, rng), rng)
  const n = { 4: 0, 5: 0, 6: 0 } as Record<number, number>
  const N = 6000
  for (let k = 0; k < N; k++) {
    item = use('chaos', item, rng)
    assertLegal(item)
    n[item.explicits.length]++
  }
  assert.ok(Math.abs(n[4] / N - 8 / 12) < 0.03, `4 mods: ${n[4] / N}`)
  assert.ok(Math.abs(n[5] / N - 3 / 12) < 0.03, `5 mods: ${n[5] / N}`)
  assert.ok(Math.abs(n[6] / N - 1 / 12) < 0.02, `6 mods: ${n[6] / N}`)
})

test('마법 아이템: 진화·변화는 옵션 1–2개, 확장은 빈 쪽을 채움, 제왕은 희귀로', () => {
  const rng = { s: 2 }
  let item = use('transmutation', newItem(LICH, 86, rng), rng)
  let two = 0
  for (let k = 0; k < 2000; k++) {
    item = use('alteration', item, rng)
    assertLegal(item)
    assert.ok(item.explicits.length === 1 || item.explicits.length === 2)
    if (item.explicits.length === 2) {
      two++
      assert.equal(CURRENCIES.augmentation.can(item), false)
    } else {
      const augged = use('augmentation', item, rng)
      assertLegal(augged)
      assert.equal(augged.explicits.length, 2)
    }
  }
  assert.ok(Math.abs(two / 2000 - 0.5) < 0.05, `2-mod share ${two / 2000}`)

  const rare = use('regal', item, rng)
  assert.equal(rare.rarity, 'rare')
  assert.equal(rare.explicits.length, item.explicits.length + 1)
  assertLegal(rare)
})

test('엑잘: 꽉 찰 때까지 하나씩 추가', () => {
  const rng = { s: 3 }
  let item = use('alchemy', newItem(REGALIA, 86, rng), rng)
  while (CURRENCIES.exalted.can(item)) {
    const before = item.explicits.length
    item = use('exalted', item, rng)
    assertLegal(item)
    assert.equal(item.explicits.length, before + 1)
  }
  assert.equal(item.explicits.length, 6)
})

test('소멸은 하나 제거, 신성은 옵션 유지·수치만 재굴림, 정제는 전부 제거', () => {
  const rng = { s: 4 }
  const item = use('alchemy', newItem(REGALIA, 86, rng), rng)

  const annulled = use('annulment', item, rng)
  assert.equal(annulled.explicits.length, item.explicits.length - 1)
  for (const m of annulled.explicits) assert.ok(item.explicits.includes(m))

  const divined = use('divine', item, rng)
  assert.deepEqual(divined.explicits.map((m) => m.id), item.explicits.map((m) => m.id))
  assertLegal(divined)

  const scoured = use('scouring', item, rng)
  assert.equal(scoured.rarity, 'normal')
  assert.equal(scoured.explicits.length, 0)
  assert.equal(CURRENCIES.chaos.can(scoured), false)
})

test('평목(평범한 목걸이)은 접두어 1개·접미어 2개까지', () => {
  const rng = { s: 5 }
  let item = use('alchemy', newItem(SIMPLEX, 86, rng), rng)
  assert.deepEqual(affixLimits(item), { prefix: 1, suffix: 2 })
  for (let k = 0; k < 500; k++) {
    item = use('chaos', item, rng)
    assertLegal(item)
    assert.ok(item.explicits.length <= 3)
  }
})

test('낮은 아이템 레벨은 낮은 레벨 옵션만', () => {
  const rng = { s: 6 }
  let item = use('alchemy', newItem(REGALIA, 30, rng), rng)
  for (let k = 0; k < 500; k++) {
    item = use('chaos', item, rng)
    assertLegal(item) // includes mod level <= ilvl
  }
})

test('영향력 옵션은 영향력 아이템에만', () => {
  const shaperOnly = (id: string) => MODS[id].spawn.some(([t, w]) => t.endsWith('_shaper') && w > 0)
  const rng = { s: 8 }
  let plain = use('alchemy', newItem(LICH, 86, rng), rng)
  let shaper = use('alchemy', newItem(LICH, 86, rng, ['shaper']), rng)
  let seen = 0
  for (let k = 0; k < 1000; k++) {
    plain = use('chaos', plain, rng)
    shaper = use('chaos', shaper, rng)
    assertLegal(shaper)
    assert.ok(!plain.explicits.some((m) => shaperOnly(m.id)))
    if (shaper.explicits.some((m) => shaperOnly(m.id))) seen++
  }
  assert.ok(seen > 0, 'shaper mods should show up on a shaper base')
})

test('타락 아이템은 변경 불가', () => {
  const rng = { s: 9 }
  const item = { ...use('alchemy', newItem(REGALIA, 86, rng), rng), corrupted: true as const }
  for (const c of Object.keys(CURRENCIES) as CurrencyId[]) assert.equal(CURRENCIES[c].can(item), false, c)
})
