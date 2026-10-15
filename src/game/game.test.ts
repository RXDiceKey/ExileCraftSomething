import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { CURRENCIES } from '../engine/currency.ts'
import { MODS } from '../engine/data.ts'
import { itemTags, newItem, rollMod, spawnWeight, type Item } from '../engine/item.ts'
import { baseKind, modLines, modText, searchText, statLabel, tierOf } from './describe.ts'
import { ACTIONS_PER_DAY, buyBase, closeDay, hunt, LAST_DAY, newGame, sell, spamAlteration, START_GOLD, useCurrency, type GameState } from './game.ts'
import { compileSearch } from './search.ts'
import { basePrice, baseResale, premium } from './shop.ts'
import { BUILDS, mergeCodex, weekday, WEEKEND_BOOM } from './meta.ts'
import { snapshot } from './history.ts'
import { quote, stackedAttributes, synergy } from './value.ts'

const baseNames = (textEn as { bases: Record<string, string> }).bases
const baseId = (name: string) => Object.keys(baseNames).find((id) => baseNames[id] === name)!
const RING = baseId('Two-Stone Ring')
const REGALIA = baseId('Vaal Regalia')
const SIMPLEX = baseId('Simplex Amulet')

const ok = <T>(r: { ok: true; state: T } | { ok: false; error: string }): T => {
  assert.ok(r.ok, r.ok ? '' : r.error)
  return r.state
}
const withMods = (base: string, ids: string[]): Item =>
  ({ ...newItem(base, 86, { s: 1 }), rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })) })

test('옵션 문장(한/영), 옵션명, 등급', () => {
  const item = withMods(RING, ['IncreasedLife7'])
  const [line] = modLines(item, 'ko').filter((l) => l.kind === 'prefix')
  assert.match(line.text[0], /^생명력 최대치 \+\d+$/)
  assert.match(modText(item, item.explicits[0], true, 'en')[0], /^\+\d+ to maximum Life$/)
  assert.equal(tierOf(withMods(REGALIA, ['IncreasedLife10']), 'IncreasedLife10'), 3) // Vigorous: 2 better life tiers on body armour
  assert.ok(searchText(withMods(REGALIA, ['SpellDamageAndManaOnWeapon6']), 'ko').length > 0)
})

test('평범한 목걸이는 옵션 수치 2배', () => {
  const plain = withMods(baseId('Gold Amulet'), ['IncreasedLife7'])
  const simplex = { ...withMods(SIMPLEX, ['IncreasedLife7']), explicits: plain.explicits }
  const n = (i: Item) => +modText(i, i.explicits[0], true, 'en')[0].match(/\d+/)![0]
  assert.equal(n(simplex), n(plain) * 2)
})

test('검색: AND, 따옴표, 부정, 옵션명, 잘못된 정규식', () => {
  const s = compileSearch('생명력 !"냉기 저항"')!
  assert.equal(s('생명력 최대치 +80\n화염 저항 +40%'), true)
  assert.equal(s('생명력 최대치 +80\n냉기 저항 +40%'), false)
  assert.equal(compileSearch('  '), null)
  assert.equal(compileSearch('(fire')!('(fire res'), true) // half-typed regex falls back to plain text
  const item = withMods(REGALIA, ['IncreasedLife10'])
  assert.ok(compileSearch('정력적인')!(searchText(item, 'ko')), 'option name is searchable')
  assert.ok(compileSearch('vigorous')!(searchText(item, 'en')))
})

test('고레벨 프리미엄은 7일차에 사라짐', () => {
  assert.equal(premium(1, 86), 10)
  assert.equal(premium(7, 86), 1)
  assert.equal(premium(14, 86), 1)
  assert.equal(premium(1, 70), 1)
  assert.ok(basePrice(REGALIA, 86, 1)! > basePrice(REGALIA, 86, 8)!)
  assert.ok(basePrice(SIMPLEX, 85, 8)! > 1_000_000, 'Simplex is very expensive')
})

test('파우스투스: 한 빌드에 몰린 옵션이 흩어진 같은 등급보다 비쌈', () => {
  // life, lightning damage to attacks, cast speed, chaos res: all on Winter Orb's ring wish list
  const focused = withMods(RING, ['IncreasedLife7', 'AddedLightningDamage9', 'IncreasedCastSpeed3', 'ChaosResist5'])
  // same life + lightning, but accuracy and life-on-kill are options no ring buyer wants: only 2 useful options
  const scattered = withMods(RING, ['IncreasedLife7', 'AddedLightningDamage9', 'IncreasedAccuracyNew4', 'LifeGainedFromEnemyDeath5'])
  const q1 = quote(focused, 'ko', 7)
  const q2 = quote(scattered, 'ko', 7)
  assert.ok(q1.top[0].value > q2.top[0].value * 3, `${q1.top[0].value} vs ${q2.top[0].value}`)
  assert.equal(q1.best?.usefulCount, 4)
  assert.equal(q1.top.length, 3)
})

test('하루 행동: 판매·사냥 4번, 골드는 다음 날, 14일차 후 종료', () => {
  let s: GameState = newGame(123)
  s = ok(buyBase(s, RING, 84))
  assert.ok(s.gold < START_GOLD)
  const uid = s.stash[0].uid
  s = ok(useCurrency(s, uid, 'alchemy'))
  const sold = ok(sell(s, uid))
  s = sold.state
  assert.equal(s.pending, sold.price)
  const goldBefore = s.gold
  for (let i = 1; i < ACTIONS_PER_DAY; i++) s = ok(hunt(s)).state
  assert.ok(s.gold > goldBefore, 'hunting pays right away')
  assert.equal(hunt(s).ok, false, 'no 5th action')

  const g = s.gold
  s = closeDay(s)
  assert.equal(s.gold, g + sold.price)
  assert.equal(s.used, 0)
  assert.equal(s.day, 2)

  while (s.day < LAST_DAY) s = closeDay(s)
  s = ok(hunt(s)).state // last day still allows actions
  s = closeDay(s)
  assert.equal(s.finished?.score, s.gold)
})

test('변옵 스팸머신: 일치하면 멈추고 손으로 누른 결과와 같음', () => {
  const wantsLife = (item: Item) => compileSearch('생명력 최대치')!(searchText(item, 'ko'))
  // 진화 결과가 이미 생명력이면 스팸할 게 없으니, 아닌 판을 고름
  let s = newGame(9)
  let uid = 0
  for (let seed = 9; ; seed++) {
    s = ok(buyBase(newGame(seed), RING, 84))
    uid = s.stash[0].uid
    s = ok(useCurrency(s, uid, 'transmutation'))
    if (!wantsLife(s.stash[0].item)) break
  }
  const r = spamAlteration(s, uid, wantsLife, { augPrefix: true, augSuffix: true, maxTries: 5000, goldCap: 1e9 })
  assert.equal(r.stop, 'matched')
  assert.ok(wantsLife(r.state.stash[0].item))
  assert.equal(r.state.gold, s.gold - r.spent)

  // replay by hand with the same RNG
  let item = s.stash[0].item
  const rng = { ...s.rng }
  for (let k = 0; k < r.alts + r.augs;) {
    item = CURRENCIES.alteration.apply(item, rng); k++
    if (wantsLife(item)) break
    if (item.explicits.length === 1 && k < r.alts + r.augs) { item = CURRENCIES.augmentation.apply(item, rng); k++ }
  }
  assert.deepEqual(snapshot(item), snapshot(r.state.stash[0].item)) // 이력 제외하고 같은 아이템
  assert.equal(r.state.stash[0].item.log!.at(-1)!.key.startsWith('cur:'), true, '스팸머신도 이력을 남김')

  const capped = spamAlteration(s, uid, () => false, { augPrefix: false, augSuffix: false, maxTries: 10, goldCap: 1e9 })
  assert.equal(capped.stop, 'maxTries')
  assert.equal(capped.alts, 10)
})

test('평범한 목걸이(옵션 효과 +100%)면 같은 옵션도 더 비쌈', () => {
  const ids = ['IncreasedLife7', 'FireResist7', 'ColdResist7']
  const plain = withMods(baseId('Gold Amulet'), ids)
  const simplex = { ...withMods(SIMPLEX, ids), explicits: plain.explicits }
  const best = (i: Item) => quote(i, 'en', 8).top[0].value
  assert.ok(best(simplex) > best(plain) * 2, `${best(simplex)} vs ${best(plain)}`)
})

test('견적은 항상 오늘 같은 베이스 시세의 90% 이상', () => {
  const junk = withMods(SIMPLEX, ['IncreasedAttackSpeed2'])
  for (const day of [1, 4, 8]) {
    assert.equal(baseResale(SIMPLEX, 86, day), Math.round(0.9 * basePrice(SIMPLEX, 86, day)))
    assert.ok(quote(junk, 'en', day).price >= baseResale(SIMPLEX, 86, day))
  }
})

test('베이스 표시: 방어 종류와 능력치', () => {
  assert.equal(baseKind(REGALIA, 'ko'), '에너지 보호막 · 지능')
  assert.equal(baseKind(baseId('Astral Plate'), 'en'), 'Armour · Str')
  assert.equal(baseKind(baseId('Two-Toned Boots'), 'ko').includes('/'), true) // hybrid bases list both
  assert.equal(baseKind(baseId('Runic Helm'), 'ko').startsWith('수호'), true)
})

test('메타: 판마다 인기 추첨, 매일 변동, 패치 2회', () => {
  const s = newGame(77)
  assert.ok(s.meta.patchDays[0] >= 4 && s.meta.patchDays[0] <= 6)
  assert.ok(s.meta.patchDays[1] >= 9 && s.meta.patchDays[1] <= 11)
  assert.notDeepEqual(s.meta.m, newGame(78).meta.m, 'different runs, different meta')
  let t = s
  while (t.day < LAST_DAY) t = closeDay(t)
  assert.equal(t.meta.notes.length, 6, '3 builds touched per patch, 2 patches')
  assert.deepEqual([...new Set(t.meta.notes.map((n) => n.day))], s.meta.patchDays)
  for (const v of Object.values(t.meta.m)) assert.ok(v > 0.1 && v < 5)
})

test('빌드 구매자: 주문 젬 마법봉은 주문 빌드가 사고, 인기도가 가격을 움직임', () => {
  const wand = withMods(baseId('Convoking Wand'), ['SpellDamageAndManaOnWeapon6', 'GlobalSpellGemsLevel1', 'IncreasedCastSpeed5', 'SpellCriticalStrikeChance5'])
  const s = newGame(5)
  const q = quote(wand, 'ko', 8, s.meta)
  const top = BUILDS.find((b) => b.id === q.top[0].id)
  assert.ok(top?.slots.weapon, `top buyer ${q.top[0].id} should be a build that buys weapons`)
  const hot = { ...s.meta, m: { ...s.meta.m, [top.id]: s.meta.m[top.id] * 2 } }
  assert.ok(quote(wand, 'ko', 8, hot).top[0].value > q.top[0].value * 1.5)
})

test('모일수록 급등: 1·2·2등급이 1·1등급+잡옵보다 비싸고, 좋은 옵션 하나 더면 몇 배', () => {
  assert.ok(synergy([1, 0.8, 0.8]) > synergy([1, 1, 0]))
  const five = synergy([1, 1, 1, 1, 1])
  const six = synergy([1, 1, 1, 1, 1, 1])
  assert.ok(six / five > 3.5, `${six / five}`)
  assert.equal(five, 1, '1등급 옵션 5개 = 슬롯 예산 (P7 기준점)')
})

test('우버 빌드는 1–2등급만 쳐 주지만 훨씬 비싸게 삼', () => {
  const uber = BUILDS.find((b) => b.tier === 'uber' && b.slots.ring)!
  const starterId = (q: ReturnType<typeof quote>) => BUILDS.find((b) => b.id === q.top[0].id)?.tier
  assert.ok(uber, 'there is an uber build buying rings')
  // A ring with exactly the options that uber build wants at tier 1 should go to an uber buyer
  const wanted = Object.keys(uber.slots.ring!.wants)
  const ids = Object.keys(MODS).filter((id) => MODS[id].gen && ['prefix', 'suffix'].includes(MODS[id].gen) && !MODS[id].dom
    && MODS[id].spawn.some(([t, w]) => t === 'ring' && w > 0) && MODS[id].stats.some(([s]) => wanted.includes(s)))
  const ring = withMods(RING, [])
  const t1 = ids.filter((id) => tierOf(ring, id) === 1)
  const picked: string[] = []
  for (const id of t1) {
    const grp = MODS[id].grp
    if (picked.some((p) => MODS[p].grp.some((g) => grp.includes(g)))) continue
    const pre = picked.filter((p) => MODS[p].gen === 'prefix').length
    const suf = picked.length - pre
    if ((MODS[id].gen === 'prefix' ? pre : suf) >= 3) continue
    picked.push(id)
  }
  const q = quote(withMods(RING, picked.slice(0, 6)), 'en', 8)
  assert.ok(['uber', 'advanced'].includes(starterId(q) ?? ''), `top buyer ${q.top[0].id}`)
})

test('베이스와 합산: 낮은 베이스의 1·1등급이 최상급 베이스의 2·2등급을 못 이김', () => {
  const ROBE = baseId('Silk Robe')
  const types = ['LocalIncreasedEnergyShieldPercent8', 'LocalIncreasedEnergyShield11', 'FireResist7', 'ColdResist7'].map((id) => MODS[id].type)
  const ofTier = (base: string, type: string, tier: number) => {
    const probe = withMods(base, [])
    const tags = itemTags(probe)
    return Object.keys(MODS).find((id) => MODS[id].type === type && !MODS[id].dom && ['prefix', 'suffix'].includes(MODS[id].gen)
      && spawnWeight(id, tags) > 0 && tierOf(probe, id) === tier)!
  }
  const robe = withMods(ROBE, types.map((t) => ofTier(ROBE, t, 1)))
  const regalia = withMods(REGALIA, types.map((t) => ofTier(REGALIA, t, 2)))
  const v = (i: Item) => quote(i, 'ko', 8).top[0].value
  assert.ok(v(regalia) > v(robe), `바알 예복 2등급 ${v(regalia)} vs 비단 로브 1등급 ${v(robe)}`)
  assert.ok(quote(robe, 'ko', 8).best!.baseQuality < 0.5)
})

test('옵션 우선도: 모든 스킬 젬 레벨은 최상급, 저항은 흔해서 싸게', () => {
  const amulet = baseId('Onyx Amulet')
  const gems = quote(withMods(amulet, ['GlobalSkillGemLevel1', 'IncreasedLife7']), 'ko', 8)
  const res = quote(withMods(amulet, ['FireResist7', 'IncreasedLife7']), 'ko', 8)
  assert.ok(gems.top[0].value > res.top[0].value * 10, `${gems.top[0].value} vs ${res.top[0].value}`)
  assert.equal(gems.best?.mods.find((m) => m.id === 'GlobalSkillGemLevel1')?.note, 'premium')
  const ring = quote(withMods(RING, ['IncreasedLife7', 'ChaosResist5']), 'ko', 8)
  assert.equal(ring.best?.mods.find((m) => m.id === 'ChaosResist5')?.note, 'common')
})

test('세트 옵션: 정의의 화염 투구의 보조 젬 옵션은 하나만 있으면 값이 떡락', () => {
  const helm = baseId('Royal Burgonet')
  const both = quote(withMods(helm, ['AreaDamageSupportedUber3', 'IncreasedBurningDamageSupportedUber3', 'IncreasedLife7']), 'ko', 8)
  const one = quote(withMods(helm, ['AreaDamageSupportedUber3', 'IncreasedLife7']), 'ko', 8)
  const rf = (q: typeof one) => q.top.find((t) => t.id === 'righteous-fire')?.value ?? 0
  assert.ok(rf(both) > rf(one) * 8, `${rf(both)} vs ${rf(one)}`)
})

test('단일 옵션 아이템은 변화의 오브로 누구나 만들 수 있어 크게 할인', () => {
  const one = quote(withMods(RING, ['IncreasedLife7']), 'ko', 8)
  const two = quote(withMods(RING, ['IncreasedLife7', 'ChaosResist5']), 'ko', 8)
  assert.equal(one.best?.usefulCount, 1)
  assert.ok(two.top[0].value > one.top[0].value * 6, `${two.top[0].value} vs ${one.top[0].value}`)
})

test('토요일 시작, 다음 주말(8·9일차)에 붐, 월요일에 거품 꺼짐', () => {
  assert.deepEqual([1, 2, 3, 8, 9, 10].map(weekday), [6, 0, 1, 6, 0, 1]) // 토 일 월 토 일 월
  const item = withMods(RING, ['IncreasedLife7', 'AddedLightningDamage9', 'IncreasedCastSpeed3', 'ChaosResist5'])
  const v = (day: number) => quote(item, 'ko', day).top[0].value
  assert.ok(Math.abs(v(8) / v(7) - WEEKEND_BOOM) < 0.01, `${v(8)} vs ${v(7)}`)
  assert.ok(Math.abs(v(9) / v(7) - WEEKEND_BOOM) < 0.01)
  assert.equal(v(10), v(7))
  assert.equal(v(2), v(7)) // 리그 시작 주말은 붐 없음
  // 베이스 되팔기 최저선은 붐이 없음: 베이스를 사서 되파는 걸로는 돈을 못 번다
  const white = newItem(RING, 84, { s: 1 })
  assert.equal(quote(white, 'ko', 8).price, baseResale(RING, 84, 8))
  assert.ok(baseResale(RING, 84, 8) < basePrice(RING, 84, 8))
})

test('능력치: 보통은 저항급, 스태킹 빌드에겐 핵심 옵션이고 높은 수치일수록 비쌈', () => {
  assert.deepEqual(stackedAttributes('kinetic-blast'), ['intelligence'])
  assert.deepEqual(stackedAttributes('winter-orb'), [])
  const helm = baseId('Hubris Circlet')
  const high = quote(withMods(helm, ['Intelligence9', 'LocalIncreasedEnergyShield9', 'IncreasedLife7']), 'ko', 7)
  const low = quote(withMods(helm, ['Intelligence4', 'LocalIncreasedEnergyShield9', 'IncreasedLife7']), 'ko', 7)
  assert.equal(high.best?.mods.find((m) => m.id === 'Intelligence9')?.note, 'stacked')
  assert.ok(high.top[0].value > low.top[0].value * 1.3, `${high.top[0].value} vs ${low.top[0].value}`)
  const ring = quote(withMods(RING, ['IncreasedLife7', 'AddedLightningDamage9', 'Dexterity8']), 'ko', 7)
  assert.equal(ring.best?.mods.find((m) => m.id === 'Dexterity8')?.note, 'common')
})

test('빌드 도감: 1위 구매자 빌드가 열리고 최고 판매가를 기억, 같은 판매를 다시 합쳐도 그대로', () => {
  const id = BUILDS[0].id
  const once = mergeCodex({}, [{ buyer: id, price: 500 }, { buyer: 'life_res', price: 900 }, { price: 50 }])
  assert.deepEqual(once, { [id]: 500 }, '범용 수요·구매자 없는 판매는 안 열림')
  assert.equal(mergeCodex(once, [{ buyer: id, price: 500 }]), once, '바뀐 게 없으면 같은 객체')
  assert.deepEqual(mergeCodex(once, [{ buyer: id, price: 800 }]), { [id]: 800 })
  assert.equal(statLabel('base_maximum_life', 'ko')?.[1], '생명력 최대치 +#')
})
