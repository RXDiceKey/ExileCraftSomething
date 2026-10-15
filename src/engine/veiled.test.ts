import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { CURRENCIES } from './currency.ts'
import { MODS } from './data.ts'
import { editable, isPrefix, newItem, rollMod, type Item } from './item.ts'
import {
  applyVeiledChaos, applyVeiledExalt, canReveal, canUnveil, canVeiledChaos, canVeiledExalt, isVeiled, reveal, unveil, unveilChoices,
} from './veiled.ts'

const baseNames = (textEn as { bases: Record<string, string> }).bases
const baseId = (name: string) => Object.keys(baseNames).find((id) => baseNames[id] === name)!
const HELMET = baseId('Royal Burgonet')
const RING = baseId('Two-Stone Ring')
const lockOf = (stat: string) => Object.keys(MODS).find((id) => MODS[id].stats.some(([s]) => s === stat) && MODS[id].dom === 'crafted')!
const make = (base: string, ids: string[], o: Partial<Item> = {}): Item =>
  ({ ...newItem(base, 86, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })), ...o })

test('장막의 카오스: 카오스처럼 재련 + 장막 옵션 1개, 해제 전엔 다른 제작 불가', () => {
  const item = make(HELMET, ['IncreasedLife10', 'FireResist7', 'ColdResist7'])
  for (let s = 0; s < 100; s++) {
    const r = applyVeiledChaos(item, { s })
    assert.equal(r.explicits.filter(isVeiled).length, 1)
    assert.ok(r.explicits.length >= 4 && r.explicits.length <= 6)
    assert.equal(editable(r), false, '장막 아이템에 속성을 부여할 수 없음')
    assert.equal(CURRENCIES.chaos.can(r), false)
    assert.equal(canVeiledChaos(r), false, '이미 장막 속성 부여가 있음')
  }
})

test('장막의 엑잘: 옵션 하나 지우고 장막 추가, 접미어 변경 불가는 지킴', () => {
  const lock = lockOf('item_generation_cannot_change_suffixes') // 접두어 칸을 씀
  const item = make(HELMET, ['IncreasedLife10', 'FireResist7', 'ColdResist7', 'LightningResist7'])
  item.explicits.push({ ...rollMod(lock, { s: 1 }), crafted: true })
  assert.ok(canVeiledExalt(item))
  for (let s = 0; s < 50; s++) {
    const r = applyVeiledExalt(item, { s })
    assert.equal(r.explicits.length, 5)
    assert.equal(r.explicits.filter((m) => !isPrefix(m) && !isVeiled(m)).length, 3, '접미어 3개는 그대로')
    assert.equal(r.explicits.filter(isVeiled).length, 1)
  }
})

test('장막 해제: 처음 볼 때 3개가 정해지고, 고르면 그 옵션으로', () => {
  const veiled = applyVeiledChaos(make(RING, ['IncreasedLife7']), { s: 4 })
  assert.ok(canReveal(veiled))
  const shown = reveal(veiled, { s: 9 })
  const target = shown.explicits.find(isVeiled)!
  assert.equal(target.unveil!.length, 3)
  assert.equal(canReveal(shown), false, '다시 열어도 그대로')
  const groups = target.unveil!.flatMap((id) => MODS[id].grp)
  assert.equal(new Set(groups).size, groups.length, '서로 다른 옵션 그룹')
  for (const id of target.unveil!) assert.equal(MODS[id].gen, MODS[target.id].gen)
  const choice = target.unveil![1]
  assert.ok(canUnveil(shown, choice))
  const done = unveil(shown, choice, { s: 1 })
  assert.ok(done.explicits.some((m) => m.id === choice))
  assert.ok(!done.explicits.some(isVeiled))
  assert.ok(editable(done), '해제 후엔 다시 제작 가능')
})

test('반지 장막 접미어에서 "최소 격분 충전 + 처치 시 격분 충전" 묶음 옵션이 나올 수 있음', () => {
  const ring = make(RING, ['IncreasedLife7'])
  const suffix = { ...rollMod('VeiledSuffix', { s: 1 }) }
  const withVeil = { ...ring, explicits: [...ring.explicits, suffix] }
  let seen = false
  for (let s = 0; s < 300 && !seen; s++) seen = unveilChoices(withVeil, suffix, { s }).includes('JunMasterVeiledMinimumFrenzyCharges___')
  assert.ok(seen)
})
