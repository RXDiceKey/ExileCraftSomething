import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { CURRENCIES } from '../engine/currency.ts'
import { newItem, rollMod, type Item } from '../engine/item.ts'
import { buyBase, newGame, useCurrency, useImprint, useRestore, type GameState, type Result } from './game.ts'
import { record, stepProbability } from './history.ts'
import { replay } from './replay.ts'
import { basePrice, baseResale, currencyPrice } from './shop.ts'
import { ELEVATED_SURGE, highEffCount, itemExpectedCost, quote } from './value.ts'

const names = (textEn as { bases: Record<string, string> }).bases
const baseId = (n: string) => Object.keys(names).find((k) => names[k] === n)!
const RING = baseId('Two-Stone Ring')
const HELMET = baseId('Royal Burgonet')
const ok = (r: Result): GameState => { assert.ok(r.ok, r.ok ? '' : r.error); return r.state }
const start = (base: string) => { const s = ok(buyBase({ ...newGame(3), day: 7, gold: 1e12 }, base, 84)); return { s, uid: s.stash[0].uid } }
const keys = (s: GameState) => (s.stash[0].item.log ?? []).map((x) => x.key)
const make = (base: string, ids: string[], o: Partial<Item> = {}): Item =>
  ({ ...newItem(base, 86, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })), ...o })

test('제작 이력: 카오스를 여러 번 굴려도 연금술과 마지막 카오스만 남고, 정제하면 리셋', () => {
  let { s, uid } = start(RING)
  s = ok(useCurrency(s, uid, 'alchemy'))
  for (let k = 0; k < 30; k++) s = ok(useCurrency(s, uid, 'chaos'))
  assert.deepEqual(keys(s), ['cur:alchemy', 'cur:chaos'])
  s = ok(useCurrency(s, uid, 'scouring'))
  assert.deepEqual(keys(s), [], '일반 베이스로 돌아가면 이력 없음')
})

test('제작 이력: 다시 굴려 같은 옵션이 나와도 새 단계 몫, 수치만 바뀌면(신성한 오브) 원래 단계 몫', () => {
  const rolled = make(RING, ['IncreasedLife7', 'FireResist8'])
  const info = { key: 'cur:chaos', cost: 1 }
  const first = record({ ...rolled, explicits: [] }, rolled, info, highEffCount)
  const again = record(first, { ...first, explicits: [rollMod('IncreasedLife7', { s: 9 }), rollMod('ColdResist8', { s: 9 })] }, info, highEffCount)
  assert.equal(again.log!.length, 1, '앞의 카오스는 잊힘')
  assert.deepEqual(again.log![0].created, ['IncreasedLife7', 'ColdResist8'])
  const divined = record(first, { ...first, explicits: first.explicits.map((m) => rollMod(m.id, { s: 9 })) }, { ...info, key: 'cur:divine' }, highEffCount)
  assert.deepEqual(divined.log, first.log, '신성한 오브는 아무 옵션도 새로 만들지 않아 남지 않고, 원래 카오스가 그대로')
})

test('각인으로 되돌리면 이력도 각인 때로', () => {
  let { s, uid } = start(RING)
  s = ok(useCurrency(s, uid, 'transmutation'))
  const atImprint = keys(s)
  s = ok(useImprint(s, uid))
  s = ok(useCurrency(s, uid, 'regal'))
  assert.ok(keys(s).includes('cur:regal'))
  s = ok(useRestore(s, uid))
  assert.deepEqual(keys(s), atImprint)
})

test('분열된 아이템: 되팔기 최저선과 기대 비용의 베이스 값은 1/10, 분열의 오브 값은 기대 비용에 안 들어감', () => {
  let { s, uid } = start(RING)
  s = ok(useCurrency(s, uid, 'alchemy'))
  while (!CURRENCIES.fracturing.can(s.stash[0].item)) s = ok(useCurrency(s, uid, 'chaos'))
  const before = s.stash[0].item
  s = ok(useCurrency(s, uid, 'fracturing'))
  const after = s.stash[0].item
  assert.equal(quote(before, 'ko', 7).baseResale, baseResale(RING, 84, 7))
  assert.equal(quote(after, 'ko', 7).baseResale, Math.round(baseResale(RING, 84, 7) * 0.1))
  // 분열의 오브는 옵션을 만들지 않아 이력에 남지 않음 (분열시킨 쓰레기 아이템이 오브 값 절반을 돌려받지 않게)
  assert.ok(!keys(s).includes('cur:fracturing'))
  const base = basePrice(RING, 84, 7)
  assert.ok(Math.abs(itemExpectedCost(after, 7) - (itemExpectedCost(before, 7) - base * 0.9)) < 1e-6)
})

test('고효율 유효 옵션: 흔한 옵션(저항)은 세지 않고, 2개 이상일 때만 셈', () => {
  assert.equal(highEffCount(make(RING, ['FireResist8', 'ColdResist8', 'LightningResist8'])), 0)
  assert.equal(highEffCount(make(RING, ['IncreasedLife7', 'FireResist8'])), 0, '좋은 옵션 하나뿐이면 운으로 치지 않음 (변화 스팸 영역)')
  assert.equal(highEffCount(make(RING, ['IncreasedLife7', 'AddedPhysicalDamage5', 'FireResist8'])), 2)
})

test('기대 비용: 드문 결과일수록 크고, 견적은 max(옵션 가치, (기대 비용 + 옵션 가치) / 2)', () => {
  // 고효율 옵션이 잘 붙은 카오스 결과를 찾을 때까지 굴림 (같은 시드라 결과는 늘 같음)
  let { s, uid } = start(RING)
  s = ok(useCurrency(s, uid, 'alchemy'))
  let plain: Item | undefined
  let lucky: Item | undefined
  for (let k = 0; k < 3000 && !lucky; k++) {
    s = ok(useCurrency(s, uid, 'chaos'))
    const m = highEffCount(s.stash[0].item)
    if (m === 0 && !plain) plain = s.stash[0].item
    if (m >= 2) lucky = s.stash[0].item
  }
  assert.ok(plain && lucky, '두 결과를 찾음')
  // 두 아이템은 같은 연금술 단계를 공유하고, 마지막 카오스만 다름: 흔한 결과는 카오스 1번 값, 드문 결과는 1/p번 값
  const chaos = currencyPrice('chaos')
  const p = stepProbability(lucky.log!.at(-1)!, replay, highEffCount)
  const ePlain = itemExpectedCost(plain, 7)
  const eLucky = itemExpectedCost(lucky, 7)
  assert.ok(p < 0.2, `고효율 2개 이상 확률 ${p}`)
  assert.ok(Math.abs(eLucky - ePlain - (chaos / p - chaos)) < 1e-6, `${eLucky} vs ${ePlain}`)
  const q = quote(lucky, 'ko', 7)
  assert.equal(q.expectedCost, Math.round(eLucky))
  assert.ok(q.price >= Math.max(q.optionValue, Math.round((q.expectedCost + q.optionValue) / 2)))
  assert.ok(q.price < q.expectedCost || q.price === q.optionValue, '운은 절반만 쳐 줌')
})

test('고양 옵션: 유효한 고양 옵션이 많을수록 폭등 (1개 2배, 2개 8배, 3개 40배)', () => {
  assert.deepEqual(ELEVATED_SURGE, [1, 2, 8, 40])
  const t1 = make(HELMET, ['AreaDamageSupportedUber3', 'IncreasedBurningDamageSupportedUber3', 'IncreasedLife10'], { influences: ['elder'] })
  const el = make(HELMET, ['AreaDamageSupportedUberMaven', 'IncreasedBurningDamageSupportedUberMaven', 'IncreasedLife10'], { influences: ['elder'] })
  const rf = (i: Item) => quote(i, 'ko', 7).top.find((x) => x.id === 'righteous-fire')?.value ?? 0
  assert.ok(rf(el) > rf(t1) * 8, `${rf(el)} vs ${rf(t1)}`)
})
