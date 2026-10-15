import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { BASES, MODS } from '../engine/data.ts'
import { baseDefence, defenceFlat, defenceInc, defences, isDefenceStat, itemTags, newItem, rollMod, spawnWeight, type Defence, type Item } from '../engine/item.ts'
import { canDeliver, COMMISSION_BONUS, decentBase, defenceBars, DEFENCE_TIER, refreshBoard, WANTS_LATE_FROM, type Commission } from './commissions.ts'
import { baseKindKeys, tierOf } from './describe.ts'
import { buyBase, closeDay, deliver, newGame, sell, doCurrency, type GameState, type Result } from './game.ts'
import { advanceMeta, BUILDS, rollMeta, RUMOR_LEAD, saturate, saturation } from './meta.ts'
import { baseGroup, buyableBases, isSpecialBase } from './shop.ts'
import { quote, slotOf } from './value.ts'

const ok = <T>(r: Result<T>): T => { assert.ok(r.ok, r.ok ? '' : r.error); return r.state }
const names = (textEn as { bases: Record<string, string> }).bases
const RING = Object.keys(names).find((k) => names[k] === 'Two-Stone Ring')!

// Does the build look at defence in that slot (then its defence asks are totals that replace options)?
const caring = (c: Commission) => Object.entries(BUILDS.find((b) => b.id === c.build)!.slots[c.slot]!.wants).some(([s, w]) => w >= 0.7 && isDefenceStat(s))

// An item that fills a commission: its base (a defence order: the top base of its kind), the first mod of each wanted
// option that meets the tier, and for a defence total the defence options its bar is built from, at full quality.
function fill(c: Commission): Item {
  const any = buyableBases().find((b) => c.classes.includes(BASES[b].cls) && !isSpecialBase(b)
    && (!c.defence || c.defence.every((d) => baseKindKeys(b).defences.includes(d))))!
  const totals = c.defence && c.wants.some((w) => 'defence' in w) ? defenceBars(any, c.defence as Defence[], 1) : undefined
  const base = c.base ?? totals?.top ?? any
  const item = newItem(base, 84, { s: 1 })
  const tags = itemTags(item)
  const ids: string[] = caring(c) ? [...(totals?.mods ?? [])] : []
  for (const w of c.wants) {
    if ('defence' in w) continue
    const id = Object.keys(MODS).find((x) => (MODS[x].gen === 'prefix' || MODS[x].gen === 'suffix') && !MODS[x].dom && !MODS[x].essenceOnly
      && MODS[x].stats.some(([s]) => s === w.stat) && MODS[x].lvl <= 84 && spawnWeight(x, tags) > 0 && tierOf(item, x) <= w.maxTier
      && !ids.some((p) => MODS[p].grp.some((g) => MODS[x].grp.includes(g))))!
    ids.push(id)
  }
  return { ...item, rarity: 'rare', quality: 20, explicits: ids.map((id) => rollMod(id, { s: 2 })) }
}

test('수요 포화: 같은 빌드·부위를 하루에 1/2/3/4개 팔면 -15/-40/-60/-80%, 남은 하락은 하루 5%p씩 회복', () => {
  const b = BUILDS[0].id
  let m = rollMeta({ s: 1 })
  assert.equal(saturation(m, b, 'helmet'), 1)
  const after = [0.85, 0.6, 0.4, 0.2, 0.2]
  for (const f of after) {
    m = saturate(m, b, 'helmet')
    assert.ok(Math.abs(saturation(m, b, 'helmet') - f) < 1e-9, `${saturation(m, b, 'helmet')} vs ${f}`)
  }
  assert.equal(saturation(m, b, 'gloves'), 1, '다른 부위는 그대로')
  let two = saturate(saturate(rollMeta({ s: 1 }), b, 'helmet'), b, 'helmet')
  two = advanceMeta(two, 2, { s: 3 })
  assert.ok(Math.abs(saturation(two, b, 'helmet') - 0.65) < 1e-9, '다음 날 40% → 35%')
  assert.ok(Math.abs(saturation(saturate(two, b, 'helmet'), b, 'helmet') - 0.5) < 1e-9, '남은 35% 위에 오늘 1개 15%')
  let one = saturate(rollMeta({ s: 1 }), b, 'helmet')
  for (let d = 2; d <= 4; d++) one = advanceMeta(one, d, { s: d })
  assert.equal(saturation(one, b, 'helmet'), 1, '15% → 10 → 5 → 0, 회복 끝')
})

test('수요 포화: 판매하면 1위 구매자의 그 부위 값이 내려감', () => {
  let s: GameState = { ...newGame(5), gold: 1e9 }
  for (let k = 0; k < 2; k++) s = ok(buyBase(s, RING, 84))
  for (const e of s.stash) s = ok(doCurrency(s, e.uid, 'alchemy'))
  const e = s.stash.find((x) => quote(x.item, 'en', s.day, s.meta).best)
  if (!e) return // 쓸모 있는 옵션이 없는 판이면 생략
  const best = quote(e.item, 'en', s.day, s.meta).best!
  const sold = ok(sell(s, e.uid)).state
  assert.ok(Math.abs(saturation(sold.meta, best.id, slotOf(BASES[e.item.base].cls)) - 0.85) < 1e-9)
})

test('소문: 패치 2일 전에 계획된 변경 하나가 새고, 패치 날 그대로 적용', () => {
  let s = newGame(11)
  const [first] = s.meta.patchDays
  const planned = s.meta.plan!.filter((n) => n.day === first)
  assert.equal(planned.length, 3)
  while (s.day < first - RUMOR_LEAD) s = closeDay(s)
  const rumor = s.meta.rumors!.at(-1)!
  assert.equal(rumor.day, first - RUMOR_LEAD)
  assert.ok(planned.includes(rumor.note))
  while (s.day < first) s = closeDay(s)
  assert.deepEqual(s.meta.notes.filter((n) => n.day === first), planned)
})

test('의뢰 게시판: 조건에 맞는 아이템을 납품하면 보수가 다음 마감에 들어오고 판매 1번을 씀', () => {
  let s: GameState = { ...newGame(7), gold: 1e9 }
  assert.ok(s.board!.length >= 1 && s.board!.length <= 3)
  const c = s.board![0]
  assert.ok(c.reward > 0)
  assert.ok(c.until >= s.day)
  const item = fill(c)
  assert.ok(canDeliver(item, c))
  s = { ...s, nextUid: s.nextUid + 2, stash: [{ uid: s.nextUid, item }, { uid: s.nextUid + 1, item: newItem(RING, 84, { s: 3 }) }] }
  const [good, bad] = s.stash
  const before = s
  assert.equal(deliver(s, bad.uid, c.id).ok, false, '안 맞는 아이템은 거절')
  s = ok(deliver(s, good.uid, c.id))
  assert.equal(s.pending, before.pending + c.reward)
  assert.equal(s.used, before.used + 1)
  assert.ok(!s.board!.includes(c))
  assert.equal(s.sales.at(-1)!.buyer, c.build)
  assert.equal(s.stash.length, 1)
})

test('의뢰 게시판: 기한이 지나면 사라지고, 마감마다 새 의뢰가 붙음 (최대 5건)', () => {
  let s = newGame(3)
  for (let d = 0; d < 8; d++) {
    s = closeDay(s)
    assert.ok(s.board!.every((c) => c.until >= s.day), '기한 지난 의뢰 없음')
    assert.ok(s.board!.length <= 5)
  }
})

test('의뢰 보수 = 같은 옵션을 파우스투스에게 보였을 때의 옵션 가치 × 1.5 (조건을 겨우 채운 아이템 기준)', () => {
  for (const day of [1, 7, 12]) {
    const meta = rollMeta({ s: day })
    for (const c of refreshBoard([], day, 14, meta, { s: day * 13 })) {
      if (!c.base) continue // defence orders: see their own test
      // Each option at the worst tier that still counts, like the order's own reference item.
      const item = newItem(c.base!, 84, { s: 1 })
      const tags = itemTags(item)
      const ids: string[] = []
      for (const w of c.wants) {
        if ('defence' in w) continue
        const fits = Object.keys(MODS).filter((x) => (MODS[x].gen === 'prefix' || MODS[x].gen === 'suffix') && !MODS[x].dom && !MODS[x].essenceOnly
          && !MODS[x].elev && MODS[x].stats.some(([st]) => st === w.stat) && MODS[x].lvl <= 84 && spawnWeight(x, tags) > 0 && tierOf(item, x) <= w.maxTier
          && !ids.some((q) => MODS[q].grp.some((g) => MODS[x].grp.includes(g))))
        ids.push(fits.reduce((a, x) => (tierOf(item, x) > tierOf(item, a) ? x : a)))
      }
      const plain: Item = { ...item, rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })) }
      const v = quote(plain, 'en', day, meta).optionValue
      // Only the rolled values differ from the order's own item (a roll moves a contribution by up to 15%).
      const ratio = c.reward / (COMMISSION_BONUS * v)
      assert.ok(ratio > 0.6 && ratio < 1.7, `${day}일차 ${c.build}: 보수 ${c.reward}, 옵션 가치 ${v}`)
    }
  }
})

test('의뢰: 처음부터 옵션 3개, 중반(7일차)부터 4개, 빌드가 가장 좋아하는 베이스를 지정', () => {
  for (const day of [1, 3, 6, 7, 10, 14]) {
    for (let seed = 1; seed <= 4; seed++) {
      for (const c of refreshBoard([], day, 14, rollMeta({ s: seed }), { s: seed * 31 + day })) {
        const options = c.wants.filter((w) => !('defence' in w) || caring(c)).length
        assert.equal(options, day >= WANTS_LATE_FROM ? 4 : 3, `${day}일차 옵션 수`)
        const item = fill(c)
        assert.ok(canDeliver(item, c), '조건 옵션을 다 붙이면 납품 가능')
        if (c.base) {
          assert.ok(c.classes.includes(BASES[c.base].cls), '베이스 지정')
          const other = buyableBases().find((b) => b !== c.base && BASES[b].cls === BASES[c.base!].cls)
          if (other) assert.equal(canDeliver({ ...item, base: other }, c), false, '다른 베이스는 안 받음')
        }
        assert.ok(c.reward > 0 && Number.isFinite(c.reward))
      }
    }
  }
})

test('방어 수치: 베이스 최댓값 + 고정 옵션, 증가% 옵션과 품질이 곱해짐', () => {
  const tw = Object.keys(names).find((k) => names[k] === 'Twilight Regalia')!
  const plain = newItem(tw, 84, { s: 1 })
  assert.equal(baseDefence(tw, 'es'), 302)
  assert.deepEqual(defences(plain), { es: 302 })
  const flat = Object.keys(MODS).find((id) => MODS[id].stats.length === 1 && MODS[id].stats[0][0] === defenceFlat('es') && MODS[id].gen === 'prefix')!
  const inc = Object.keys(MODS).find((id) => MODS[id].stats.length === 1 && MODS[id].stats[0][0] === defenceInc('es')[0] && MODS[id].gen === 'prefix')!
  const item: Item = { ...plain, rarity: 'rare', quality: 20, explicits: [{ id: flat, values: [100] }, { id: inc, values: [100] }] }
  assert.equal(defences(item).es, Math.round((302 + 100) * (1 + 120 / 100)))
})

test('방어구 의뢰: 방어 종류마다 합계 조건, 최고 베이스는 기준 등급으로 되고 낮은 베이스는 같은 등급으로 모자람', () => {
  let found = 0
  for (let seed = 1; seed < 60 && found < 5; seed++) {
    for (const c of refreshBoard([], 7, 14, rollMeta({ s: seed }), { s: seed * 7 })) {
      const totals = c.wants.filter((w) => 'defence' in w)
      if (!totals.length || !caring(c)) continue
      found++
      assert.equal(c.base, undefined, '같은 종류면 어느 베이스든')
      assert.equal(totals.length, c.defence!.length, '방어 종류 수만큼')
      assert.ok(totals.length <= 2, '세 방어 베이스는 특수 케이스')
      const tier = DEFENCE_TIER[BUILDS.find((b) => b.id === c.build)!.tier]
      const kind = buyableBases().find((b) => c.classes.includes(BASES[b].cls) && !isSpecialBase(b)
        && c.defence!.every((d) => baseKindKeys(b).defences.includes(d)) && baseKindKeys(b).defences.length === c.defence!.length)!
      const bars = defenceBars(kind, c.defence as Defence[], tier)
      const lowest = (id: string) => ({ id, values: MODS[id].stats.map(([, a, b]) => Math.min(a, b)) })
      const onTop: Item = { ...newItem(bars.top, 84, { s: 1 }), rarity: 'rare', explicits: bars.mods.map(lowest) }
      for (const w of totals) {
        if (!('defence' in w)) continue
        assert.ok((defences(onTop)[w.defence] ?? 0) >= w.min, '최고 베이스 + 기준 등급(최저 수치)이면 충족')
        const lower = buyableBases().find((b) => baseGroup(b) === baseGroup(bars.top) && baseDefence(b, w.defence) < baseDefence(bars.top, w.defence) * 0.8)
        if (lower) assert.ok((defences({ ...onTop, base: lower })[w.defence] ?? 0) < w.min, '낮은 베이스는 같은 등급으론 모자람')
      }
    }
  }
  assert.ok(found > 0, '방어구 의뢰가 나옴')
})

test('방어를 안 따지는 빌드의 방어구 의뢰: 옵션은 그대로, 거기에 두 번째로 좋은 베이스만큼의 방어 수치', () => {
  let found = 0
  for (let seed = 1; seed < 60 && found < 5; seed++) {
    for (const c of refreshBoard([], 3, 14, rollMeta({ s: seed }), { s: seed * 11 })) {
      const floors = c.wants.filter((w) => 'defence' in w)
      if (!floors.length || caring(c)) continue
      found++
      assert.equal(c.wants.length - floors.length, 3, '옵션 조건 수는 그대로')
      const kind = buyableBases().find((b) => c.classes.includes(BASES[b].cls) && !isSpecialBase(b)
        && c.defence!.every((d) => baseKindKeys(b).defences.includes(d)) && baseKindKeys(b).defences.length === c.defence!.length)!
      assert.deepEqual(floors, decentBase(kind, c.defence as Defence[]))
      const kin = buyableBases().filter((b) => baseGroup(b) === baseGroup(kind) && !isSpecialBase(b))
        .sort((x, y) => baseDefence(y, c.defence![0] as Defence) - baseDefence(x, c.defence![0] as Defence))
      const bare = (b: string) => floors.every((w) => 'defence' in w && (defences(newItem(b, 84, { s: 1 }))[w.defence] ?? 0) >= w.min)
      assert.ok(bare(kin[0]), '최고 베이스는 맨몸으로 통과')
      assert.ok(!bare(kin.at(-1)!), '가장 낮은 베이스는 맨몸으로 안 됨')
    }
  }
  assert.ok(found > 0, '그런 의뢰가 나옴')
})
