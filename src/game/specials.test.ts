import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { CURRENCIES } from '../engine/currency.ts'
import { BASES, MODS } from '../engine/data.ts'
import { newItem, rollMod, type Item } from '../engine/item.ts'
import { isExclusive } from '../engine/recombinator.ts'
import { tierOf } from './describe.ts'
import { buyUnidentified, newGame, type GameState, type Result } from './game.ts'
import { basePrice, buyableBases, isSpecialBase, isTopBase } from './shop.ts'
import { dropOptions, GRASPING_MAIL, SACRIFICIAL_GARB, SPECIAL_ILVL, UNID_MARKUP, unidentifiedPrice } from './specials.ts'
import { DROP_PREMIUM, quote, RARITY_MAX, RARITY_MIN, rarityOf } from './value.ts'

const names = (textEn as { bases: Record<string, string> }).bases
const baseId = (n: string) => Object.keys(names).find((k) => names[k] === n)!
const ok = (r: Result): GameState => { assert.ok(r.ok, r.ok ? '' : r.error); return r.state }
const rare = (base: string, ids: string[]): Item => ({ ...newItem(base, 83, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })) })

test('드롭 전용 옵션: 출처와 붙는 부위 (망령 +1은 몸통 갑옷, 균열 군주 옵션은 탐욕스러운 사슬옷, 가중치 위키대로)', () => {
  assert.equal(MODS.MaximumMinionCountSpectreDelve.drop, 'delve')
  assert.ok(MODS.MaximumMinionCountSpectreDelve.on!.every((o) => o.startsWith('Body Armour')))
  assert.deepEqual(MODS.MaximumMinionCountAmuletZombieDelve.on, ['Amulet'])
  assert.equal(MODS.FireResistEnhancedLevel50ModLeech.drop, 'incursion')
  assert.equal(Object.keys(MODS).filter((id) => MODS[id].drop === 'breach').length, 25)
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

test('특수 옵션 가치: 망령 +1 갑옷은 망령 빌드가 비싸게 사고, 좀비 +1은 원하는 빌드가 없음', () => {
  const body = baseId('Vaal Regalia')
  const spectre = (i: Item) => quote(i, 'ko', 7).top.find((x) => x.id === 'raise-spectre')?.value ?? 0
  const plain = rare(body, ['IncreasedLife10', 'LocalIncreasedEnergyShieldPercent8', 'FireResist8'])
  const withSpectre = rare(body, ['IncreasedLife10', 'LocalIncreasedEnergyShieldPercent8', 'FireResist8', 'MaximumMinionCountSpectreDelve'])
  assert.ok(spectre(withSpectre) > spectre(plain) * 2, `${spectre(withSpectre)} vs ${spectre(plain)}`)
  assert.equal(quote(rare(body, ['MaximumMinionCountZombieDelve']), 'ko', 7).best, undefined)
  assert.equal(DROP_PREMIUM, 1.5)
})

test('미확인 특수 베이스: 사는 순간 그 베이스에 붙는 드롭 옵션 하나(균열은 1–3개)가 정해짐', () => {
  const body = baseId('Vaal Regalia')
  let s: GameState = { ...newGame(4), gold: 1e12 }
  for (let k = 0; k < 20; k++) {
    s = ok(buyUnidentified(s, 'delve', body))
    const item = s.stash.at(-1)!.item
    const drops = item.explicits.filter((m) => MODS[m.id].drop)
    assert.equal(item.base, body)
    assert.equal(item.ilvl, SPECIAL_ILVL)
    assert.equal(drops.length, 1)
    assert.ok(dropOptions('delve', body).includes(drops[0].id))
  }
  for (let k = 0; k < 20; k++) {
    s = ok(buyUnidentified(s, 'breach', GRASPING_MAIL))
    const n = s.stash.at(-1)!.item.explicits.filter((m) => MODS[m.id].drop === 'breach').length
    assert.ok(n >= 1 && n <= 3)
  }
  assert.equal(buyUnidentified(s, 'breach', body).ok, false, '균열은 탐욕스러운 사슬옷만')
  assert.equal(buyUnidentified({ ...s, gold: 0 }, 'delve', body).ok, false)
})

test('미확인 가격: 베이스 값 ×1.5 이상, 쓸모 있는 옵션이 나올 확률이 높을수록 비쌈', () => {
  const body = baseId('Vaal Regalia')
  for (const b of [body, GRASPING_MAIL]) {
    const src = b === GRASPING_MAIL ? 'breach' : 'delve'
    assert.ok(unidentifiedPrice(src, b, 7) >= Math.round(UNID_MARKUP * basePrice(b, SPECIAL_ILVL, 7)))
  }
  const ring = baseId('Two-Stone Ring')
  // 사원 반지 옵션은 대부분 쓸모 있음, 장화 탐광 옵션은 대부분 쓸모 없음: 베이스 값을 뺀 웃돈 비교
  const premium = (src: 'delve' | 'incursion', b: string) => unidentifiedPrice(src, b, 7) - Math.round(UNID_MARKUP * basePrice(b, SPECIAL_ILVL, 7))
  assert.ok(premium('incursion', ring) > premium('delve', baseId('Two-Toned Boots')))
  assert.equal(unidentifiedPrice('delve', baseId('Fugitive Boots'), 7) >= 0, true)
})

test('상점: 무기는 종류별, 방어구는 부위·능력치별 최고 등급 2개와 특수 베이스만 먼저 보임', () => {
  const shown = buyableBases().filter(isTopBase)
  const normal = (cls: string, tag?: string) => shown.filter((b) => BASES[b].cls === cls && !isSpecialBase(b) && (!tag || BASES[b].tags.includes(tag)))
  assert.equal(normal('Wand').length, 2)
  assert.equal(normal('Body Armour', 'int_armour').length, 2)
  assert.ok(shown.includes(baseId('Twilight Regalia')), '지능 몸통 갑옷 최고 등급')
  assert.ok(!shown.includes(baseId('Vaal Regalia')) && !shown.includes(baseId('Simple Robe')), '하급 베이스는 숨김')
  assert.ok(shown.includes(baseId('Convoking Wand')), '특수 베이스는 따로 보임')
  assert.ok(buyableBases().filter((b) => BASES[b].cls === 'Ring').every(isTopBase), '반지는 고정 옵션으로 갈려서 전부')
})

test('희소성: 같은 등급 표준(가중치 1000)보다 드문 옵션은 비싸지만 크게 눌러서 (10배 드물어도 2배 이하)', () => {
  const ring = newItem(baseId('Vermillion Ring'), 84, { s: 1 })
  const tier1 = (stat: string) => Object.keys(MODS).find((id) => MODS[id].stats.length === 1 && MODS[id].stats[0][0] === stat
    && !MODS[id].dom && tierOf(ring, id) === 1 && rarityOf(ring, id) !== undefined)!
  const life = tier1('base_maximum_life')
  const allAttr = tier1('additional_all_attributes')
  assert.equal(rarityOf(ring, life), 1, '생명력 1등급은 표준')
  assert.ok(Math.abs(rarityOf(ring, allAttr) - (1 + 0.3 * Math.log(1000 / 400))) < 1e-9, '모든 능력치 1등급(가중치 400) ×1.27')
  for (const id of Object.keys(MODS).filter((x) => MODS[x].gen === 'suffix').slice(0, 300)) {
    const r = rarityOf(ring, id)
    assert.ok(r >= RARITY_MIN && r <= RARITY_MAX)
  }
})

test('콘텐츠 전용 베이스는 자기 콘텐츠 옵션으로만: 탐욕스러운 사슬옷은 균열만, 희생의 의복·강탈 실험 베이스는 매물 없음', () => {
  assert.ok(dropOptions('breach', GRASPING_MAIL).length > 0)
  for (const s of ['delve', 'incursion'] as const) {
    assert.deepEqual(dropOptions(s, GRASPING_MAIL), [], `탐욕스러운 사슬옷 ${s}`)
    assert.deepEqual(dropOptions(s, SACRIFICIAL_GARB), [], `희생의 의복 ${s}`)
    const heist = buyableBases().filter((id) => BASES[id].tags.includes('experimental_base') && dropOptions(s, id).length)
    assert.deepEqual(heist, [], `강탈 베이스 ${s}`)
  }
  // Atlas bases drop anywhere: a Convoking Wand still comes out of Delve.
  const convoking = buyableBases().find((id) => BASES[id].tags.includes('wandatlas1'))!
  assert.ok(dropOptions('delve', convoking).length > 0)
})
