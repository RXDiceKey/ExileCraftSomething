import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { CURRENCIES } from '../engine/currency.ts'
import { BASES, MODS } from '../engine/data.ts'
import { newItem, rollMod, type Item } from '../engine/item.ts'
import { isExclusive } from '../engine/recombinator.ts'
import { tierOf } from './describe.ts'
import { buySpecial, closeDay, newGame, type GameState, type Result } from './game.ts'
import { basePrice } from './shop.ts'
import { GRASPING_MAIL, SPECIAL_MARKUP } from './specials.ts'
import { DROP_PREMIUM, quote } from './value.ts'

const names = (textEn as { bases: Record<string, string> }).bases
const baseId = (n: string) => Object.keys(names).find((k) => names[k] === n)!
const ok = (r: Result): GameState => { assert.ok(r.ok, r.ok ? '' : r.error); return r.state }
const rare = (base: string, ids: string[]): Item => ({ ...newItem(base, 83, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })) })
const fitsOn = (base: string, id: string) => (MODS[id].on ?? []).some((o) => {
  const [cls, tag] = o.split(':')
  return BASES[base].cls === cls && (!tag || BASES[base].tags.includes(tag))
})

test('드롭 전용 옵션: 출처와 붙는 부위 (망령 +1은 몸통 갑옷, 균열 군주 옵션은 탐욕스러운 사슬옷, 가중치 위키대로)', () => {
  assert.equal(MODS.MaximumMinionCountSpectreDelve.drop, 'delve')
  assert.ok(MODS.MaximumMinionCountSpectreDelve.on!.every((o) => o.startsWith('Body Armour')))
  assert.deepEqual(MODS.MaximumMinionCountAmuletZombieDelve.on, ['Amulet'])
  assert.equal(MODS.FireResistEnhancedLevel50ModLeech.drop, 'incursion')
  const breach = Object.keys(MODS).filter((id) => MODS[id].drop === 'breach')
  assert.equal(breach.length, 25)
  assert.equal(MODS.BreachBodyAllDefences1.dw, 1000)
  assert.equal(MODS.BreachBodyArmourIncreasedByUncappedFireResistance1____.dw, 250)
  for (const id of ['MaximumFireResistDelve', 'CurseEffectivenessDelve', 'DoomGainRateDelve', 'CurseDurationDelve']) assert.equal(MODS[id], undefined, `${id}는 옛 옵션`)
})

test('드롭 전용 옵션은 자연적으로 안 붙고, 1등급 취급, 재조합기에선 배타 옵션', () => {
  const body = baseId('Vaal Regalia')
  for (let s = 0; s < 200; s++) {
    const item = CURRENCIES.alchemy.apply(newItem(body, 83, { s }), { s })
    assert.ok(item.explicits.every((m) => !MODS[m.id].drop))
  }
  const item = rare(body, ['MaximumMinionCountSpectreDelve'])
  assert.equal(tierOf(item, 'MaximumMinionCountSpectreDelve'), 1)
  assert.ok(isExclusive(item.explicits[0]))
})

test('특수 옵션 가치: 망령 +1 갑옷은 망령 빌드가 비싸게 사고, 사원 저항은 일반 1등급 저항의 1.5배로 침', () => {
  const body = baseId('Vaal Regalia')
  const spectre = (i: Item) => quote(i, 'ko', 7).top.find((x) => x.id === 'raise-spectre')?.value ?? 0
  const plain = rare(body, ['IncreasedLife10', 'LocalIncreasedEnergyShieldPercent8', 'FireResist8'])
  const withSpectre = rare(body, ['IncreasedLife10', 'LocalIncreasedEnergyShieldPercent8', 'FireResist8', 'MaximumMinionCountSpectreDelve'])
  assert.ok(spectre(withSpectre) > spectre(plain) * 2, `${spectre(withSpectre)} vs ${spectre(plain)}`)
  const zombie = rare(body, ['MaximumMinionCountZombieDelve'])
  assert.equal(quote(zombie, 'ko', 7).best, undefined, '좀비 수를 원하는 빌드는 없음')
  assert.equal(DROP_PREMIUM, 1.5)
})

test('특수 매물: 매일 균열·탐광·사원 하나씩, 베이스 값 2배 이상, 사면 보관함에 그대로 들어오고 매물에서 빠짐', () => {
  let s: GameState = { ...newGame(4), gold: 1e12 }
  for (let d = 0; d < 4; d++) {
    assert.deepEqual(s.specials!.map((o) => o.source), ['breach', 'delve', 'incursion'])
    for (const o of s.specials!) {
      const drops = o.item.explicits.filter((m) => MODS[m.id].drop)
      assert.ok(drops.every((m) => MODS[m.id].drop === o.source))
      if (o.source === 'breach') {
        assert.equal(o.item.base, GRASPING_MAIL)
        assert.ok(drops.length >= 1 && drops.length <= 3)
      } else {
        assert.equal(drops.length, 1)
        assert.ok(fitsOn(o.item.base, drops[0].id), '그 옵션이 붙는 부위')
        assert.ok(!BASES[o.item.base].tags.includes('not_for_sale'))
      }
      assert.ok(o.price >= SPECIAL_MARKUP * basePrice(o.item.base, o.item.ilvl, s.day) - 1)
      assert.ok(o.price > quote(o.item, 'ko', s.day, s.meta).price, '바로 되팔면 손해')
    }
    s = closeDay(s)
  }
  const [offer] = s.specials!
  const after = ok(buySpecial(s, offer.id))
  assert.equal(after.gold, s.gold - offer.price)
  assert.equal(after.stash.at(-1)!.item, offer.item)
  assert.ok(!after.specials!.includes(offer))
  assert.equal(buySpecial({ ...s, gold: 0 }, offer.id).ok, false)
})
