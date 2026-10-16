import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { CURRENCIES } from '../engine/currency.ts'
import { MODS } from '../engine/data.ts'
import { itemTags, newItem, rollMod, spawnWeight, type Item } from '../engine/item.ts'
import { baseKind, modLines, modText, searchText, statLabel, tierOf } from './describe.ts'
import { ACTIONS_PER_DAY, buyBase, closeDay, DEBT_DAYS, DEBT_LIMIT, doBench, doMirror, hunt, LAST_DAY, newGame, sell, spamAlteration, START_GOLD, doCurrency, type GameState } from './game.ts'
import { benchOptions, CRAFTING } from '../engine/crafting.ts'
import { compileSearch } from './search.ts'
import { basePrice, baseResale, lifeforcePrice, MIRROR, premium, priceOf } from './shop.ts'
import { BUILDS, LATE_DAY, mergeCodex, popularity, STARTER_DAYS, trend, weekday, WEEKEND_BOOM } from './meta.ts'
import { snapshot } from './history.ts'
import { CORRUPT_GOOD, CORRUPT_PLAIN, MIRROR_CAP, MIRROR_FEE, MIRROR_ORIGINAL, quote, shortfall, stackedAttributes, synergy } from './value.ts'

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

test('생기 가격: 7일차까지 세 색이 같고, 8일차부터 노란색(혈기)만 올라 11일차에 시세', () => {
  for (let day = 1; day <= 7; day++) {
    assert.equal(lifeforcePrice('vivid', day), lifeforcePrice('wild', day))
    assert.equal(lifeforcePrice('primal', day), lifeforcePrice('wild', day))
  }
  for (let day = 8; day <= 11; day++) assert.ok(lifeforcePrice('vivid', day) > lifeforcePrice('vivid', day - 1), `${day}일차 혈기 상승`)
  assert.equal(lifeforcePrice('vivid', 14), priceOf('Vivid Crystallised Lifeforce'))
  assert.ok(lifeforcePrice('vivid', 11) > 5 * lifeforcePrice('wild', 11))
  assert.equal(lifeforcePrice('wild', 14), lifeforcePrice('wild', 1), '야생·원시는 그대로')
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
  s = ok(doCurrency(s, uid, 'alchemy'))
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
    s = ok(doCurrency(s, uid, 'transmutation'))
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

  // 이미 맞는 아이템에서 다시 누르면 다시 돌림 (사용자)
  const again = spamAlteration(r.state, uid, wantsLife, { augPrefix: true, augSuffix: true, maxTries: 5000, goldCap: 1e9 })
  assert.ok(again.alts >= 1, '적어도 한 번은 굴림')
  assert.equal(again.stop, 'matched')
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

test('리그 진행: 4일차까지는 스타터가 가장 흥하고, 5일차부터 고급·우버가 슬슬 올라옴', () => {
  const sum = (tier: string, day: number) => BUILDS.filter((b) => b.tier === tier).reduce((s, b) => s + popularity(undefined, b.id, day), 0)
  const uber = BUILDS.find((b) => b.tier === 'uber')!.id
  const starter = BUILDS.find((b) => b.tier === 'starter')!.id
  for (let day = 1; day <= LAST_DAY; day++) {
    const [s, a, u] = ['starter', 'advanced', 'uber'].map((tier) => sum(tier, day))
    assert.equal(s, sum('starter', 1), '스타터는 그대로')
    if (day <= STARTER_DAYS) {
      assert.ok(s > 5 * (a + u), `${day}일차 스타터 ${s} vs 고급·우버 ${a + u}`)
      assert.equal(u, sum('uber', 1))
      assert.equal(trend(undefined, uber, day), null)
    } else if (day <= LATE_DAY) {
      assert.ok(a > sum('advanced', day - 1) && u > sum('uber', day - 1), `${day}일차에 고급·우버가 오름`)
      assert.equal(trend(undefined, uber, day), 'rising')
    } else {
      assert.equal(u, sum('uber', LATE_DAY), '후반엔 더 오르지 않음')
      assert.equal(trend(undefined, uber, day), null)
    }
    assert.equal(trend(undefined, starter, day), null)
  }
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
  const early = quote(withMods(RING, picked.slice(0, 6)), 'en', 2)
  assert.ok(q.top[0].value > early.top[0].value * 5, `리그 초반엔 우버 구매자가 적음: 2일차 ${early.top[0].value}, 8일차 ${q.top[0].value}`)
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

test('쓸모 있는 옵션 3개부터 제값: 2개면 ×0.1, 1개면 ×0.01 (변화·제왕·엑잘로 쉽게 나오는 아이템)', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(shortfall).map((x) => +x.toFixed(4)), [0, 0.01, 0.1, 1, 1])
  const one = quote(withMods(RING, ['IncreasedLife7']), 'ko', 8)
  const two = quote(withMods(RING, ['IncreasedLife7', 'ChaosResist5']), 'ko', 8)
  const three = quote(withMods(RING, ['IncreasedLife7', 'ChaosResist5', 'FireResist7']), 'ko', 8)
  assert.equal(one.best?.usefulCount, 1)
  assert.ok(two.top[0].value > one.top[0].value * 6, `${two.top[0].value} vs ${one.top[0].value}`)
  assert.equal(three.best?.usefulCount, 3)
  // 2개짜리는 예산 큰 우버 빌드가 ×0.1로 사고, 3개짜리는 스타터 빌드가 제값에 삼
  assert.ok(three.top[0].value > two.top[0].value * 3, `세 번째 좋은 옵션에서 크게 오름: ${three.top[0].value} vs ${two.top[0].value}`)
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

test('미러급: 원본은 거울 3개, 복사본은 거울 + 수수료, 못 미치면 거울 반값 아래', () => {
  // Ice Spear (uber) amulet: all tier 1, one elevated (Maven) option, five options, a top base.
  const amulet = { ...withMods('Metadata/Items/Amulets/Amulet1', ['CriticalStrikeMultiplierInfluenceMaven__', 'IncreasedCastSpeed4',
    'IncreasedLife8', 'GlobalSkillGemLevel1', 'GlobalColdGemLevel1__']), influences: ['shaper', 'elder'] } as Item
  const mirror = priceOf(MIRROR)
  const q = quote(amulet, 'ko', 10)
  assert.ok(q.best?.mirror, `미러급이어야 함: ${q.best?.id}`)
  assert.equal(q.optionValue, Math.round(MIRROR_ORIGINAL * mirror * q.boom))
  const copy = quote({ ...amulet, mirrored: true }, 'ko', 10)
  assert.equal(copy.optionValue, Math.round((mirror + MIRROR_FEE * priceOf('Divine Orb')) * copy.boom))
  // One tier-2 option, or no special option: not mirror tier, under half a mirror.
  const t2 = quote({ ...amulet, explicits: amulet.explicits.map((m) => (m.id === 'IncreasedLife8' ? rollMod('IncreasedLife7', { s: 2 }) : m)) }, 'ko', 10)
  const plain = quote({ ...amulet, explicits: amulet.explicits.map((m) => (m.id === 'CriticalStrikeMultiplierInfluenceMaven__' ? rollMod('CriticalMultiplier6', { s: 2 }) : m)) }, 'ko', 10)
  for (const x of [t2, plain]) {
    assert.ok(!x.best?.mirror)
    assert.ok(x.optionValue <= MIRROR_CAP * mirror * x.boom, `${x.optionValue}`)
  }
  // Simplex Amulet (+100% explicit effect, 3 options): once 23 mirrors for a starter build, now bent under the cap.
  const simplex = quote(withMods('Metadata/Items/Amulets/AmuletE3', ['GlobalDamageOverTimeMultiplier1h5', 'GlobalSkillGemLevel1', 'GlobalLightningGemLevel1']), 'ko', 10)
  assert.ok(simplex.optionValue <= MIRROR_CAP * mirror * simplex.boom && simplex.optionValue > 0.4 * mirror, `${simplex.optionValue}`)
})

test('상점: 아이템 레벨이 베이스의 최소 등장 레벨보다 낮으면 못 삼', () => {
  const s = newGame(3)
  const base = Object.keys(baseNames).find((id) => baseNames[id] === 'Vaal Regalia')!
  const low = buyBase(s, base, 60)
  assert.ok(!low.ok && low.error === 'ilvlTooLow')
  assert.ok(buyBase(s, base, 84).ok)
})

test('작업대 교체: 기존 제작 옵션을 지우는 정제의 오브 값이 제작 값에 더해짐', () => {
  const base = Object.keys(baseNames).find((id) => baseNames[id] === 'Vaal Regalia')!
  const s0 = newGame(5)
  const s1: GameState = { ...s0, gold: 1_000_000, stash: [{ uid: 1, item: withMods(base, ['FireResist7']) }], nextUid: 2 }
  const life = benchOptions(s1.stash[0].item).find((i) => MODS[CRAFTING.bench[i].mod].stats.some(([st]) => st === 'base_maximum_life'))!
  const s2 = ok(doBench(s1, 1, life))
  assert.equal(s1.gold - s2.gold, CRAFTING.bench[life].cost, '처음엔 제작 값만')
  const cold = benchOptions(s2.stash[0].item).find((i) => MODS[CRAFTING.bench[i].mod].stats.some(([st]) => st === 'base_cold_damage_resistance_%'))!
  const s3 = ok(doBench(s2, 1, cold))
  assert.equal(s2.gold - s3.gold, CRAFTING.bench[cold].cost + priceOf('Orb of Scouring'), '교체는 정제 값 추가')
  assert.equal(s3.stash[0].item.explicits.filter((m) => m.crafted).length, 1)
})

test('타락: 그냥 타락은 ×0.7(베이스 되팔기도), 그 빌드가 원하는 타락 옵션은 ×1.5, 거울로 복사 못 하고 미러급도 아님', () => {
  const glove = baseId('Sorcerer Gloves')
  const mods = ['IncreasedLife8', 'ColdResist7', 'FireResist7', 'LightningResist7']
  const corruptMod = (type: string) => Object.keys(MODS).find((id) => MODS[id].gen === 'corrupted' && MODS[id].type === type)!
  const plain = withMods(glove, mods)
  const v = quote(plain, 'en', 8)
  const just = quote({ ...plain, corrupted: true }, 'en', 8)
  assert.ok(Math.abs(just.optionValue / v.optionValue - CORRUPT_PLAIN) < 0.01, `${just.optionValue} / ${v.optionValue}`)
  assert.equal(just.baseResale, Math.round(baseResale(glove, 86, 8) * CORRUPT_PLAIN))
  // +1 to Level of Socketed Gems: any build takes it. Item rarity: no build wants it.
  const good = quote({ ...plain, corrupted: true, implicits: [rollMod(corruptMod('LocalIncreaseSocketedGemLevel'), { s: 1 })] }, 'en', 8)
  assert.ok(Math.abs(good.optionValue / v.optionValue - CORRUPT_GOOD) < 0.01)
  assert.equal(good.best!.corrupt, CORRUPT_GOOD)
  const rarity = quote({ ...plain, corrupted: true, implicits: [rollMod(corruptMod('IncreasedItemRarity'), { s: 1 })] }, 'en', 8)
  assert.equal(rarity.best!.corrupt, CORRUPT_PLAIN)
  // Elemental Weakness on hit: an elemental build's, not a physical one's.
  const ew = { ...plain, corrupted: true as const, implicits: [rollMod(corruptMod('CurseOnHitLevelElementalWeakness'), { s: 1 })] }
  const phys = BUILDS.find((b) => b.id === 'boneshatter')!
  const ele = BUILDS.find((b) => b.id === 'lightning-arrow')!
  const factor = (id: string, item: Item) => {
    const q = quote(item, 'en', 8)
    return q.best?.id === id ? q.best.corrupt : undefined
  }
  assert.ok([CORRUPT_GOOD, undefined].includes(factor(ele.id, ew)))
  assert.ok([CORRUPT_PLAIN, undefined].includes(factor(phys.id, ew)))
  // A Mirror copies no corrupted item.
  const s: GameState = { ...newGame(4), gold: 1e9, stash: [{ uid: 1, item: { ...plain, corrupted: true } }], nextUid: 2 }
  assert.equal(doMirror(s, 1).ok, false)
})

test('따갚돼 모드: 골드가 -100만까지 내려가고, 3일 연속 음수로 마감하면 게임 오버 (보통 모드는 0 아래로 못 감)', () => {
  const base = baseId('Vaal Regalia')
  const price = basePrice(base, 84, 1)
  // Normal mode: no debt.
  assert.equal(buyBase({ ...newGame(2), gold: price - 1 }, base, 84).ok, false)
  // Debt mode: down to -DEBT_LIMIT, not past it.
  let s: GameState = { ...newGame(2, true), gold: 0 }
  assert.ok(s.debt)
  s = ok(buyBase(s, base, 84))
  assert.equal(s.gold, -price)
  assert.equal(buyBase({ ...s, gold: -DEBT_LIMIT + price - 1 }, base, 84).ok, false, '-100만 아래로는 못 감')
  // Three closes in a row below zero end the run; climbing back to zero resets the count.
  s = closeDay(s)
  assert.equal(s.debtDays, 1)
  s = closeDay({ ...s, pending: -s.gold }) // paid back at this close
  assert.equal(s.debtDays, 0)
  s = { ...s, gold: -1 }
  for (let k = 1; k < DEBT_DAYS; k++) {
    s = closeDay(s)
    assert.equal(s.finished, undefined)
  }
  s = closeDay(s)
  assert.ok(s.finished?.bankrupt, `${DEBT_DAYS}일 연속 음수`)
})
