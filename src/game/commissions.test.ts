import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { BASES, MODS } from '../engine/data.ts'
import { baseDefence, defenceFlat, defenceInc, defences, DPS_STATS, isDefenceStat, itemTags, newItem, spawnWeight, type Defence, type Item, type RolledMod } from '../engine/item.ts'
import {
  canDeliver, COMMISSION_BONUS, decentBase, meetsWant, defenceBars, DEFENCE_TIER, dpsBar, dpsKind, EARLY_DAYS, EARLY_REWARD_MAX, MIN_REWARD, refreshBoard, WANTS_LATE_FROM,
  type Commission,
} from './commissions.ts'
import { baseKindKeys, tierOf } from './describe.ts'
import { buyBase, closeDay, deliver, dismissCommission, newGame, sell, doCurrency, type GameState, type Result } from './game.ts'
import { advanceMeta, BUILDS, ELE_RES, elementalCount, rollMeta, RUMOR_LEAD, saturate, saturation, SINGLE_ELE_RES } from './meta.ts'
import { baseGroup, basePrice, buyableBases, isSpecialBase } from './shop.ts'
import { quote, slotOf } from './value.ts'

const ok = <T>(r: Result<T>): T => { assert.ok(r.ok, r.ok ? '' : r.error); return r.state }
const names = (textEn as { bases: Record<string, string> }).bases
const RING = Object.keys(names).find((k) => names[k] === 'Two-Stone Ring')!

// Does the build look at defence in that slot (then its defence asks are totals that replace options)?
const caring = (c: Commission) => Object.entries(BUILDS.find((b) => b.id === c.build)!.slots[c.slot]!.wants).some(([s, w]) => w >= 0.7 && isDefenceStat(s))
// The stats that fill an ask: the elemental resistance total takes a one-element resistance the build doesn't list itself.
const fillsAsk = (st: string, ask: string, wants: Record<string, number>) => (ask === ELE_RES ? SINGLE_ELE_RES.test(st) && !(st in wants) : st === ask)

// An item that fills a commission: its base (a defence order: the top base of its kind), the first mod of each wanted
// option that meets the tier, and for a defence total the defence options its bar is built from, at full quality.
function fill(c: Commission): Item {
  const any = buyableBases().find((b) => c.classes.includes(BASES[b].cls) && !isSpecialBase(b)
    && (!c.defence || c.defence.every((d) => baseKindKeys(b).defences.includes(d))))!
  const totals = c.defence && c.wants.some((w) => 'defence' in w) ? defenceBars(any, c.defence as Defence[], 1) : undefined
  // A DPS order: the class's top base with the build's damage options at tier 1.
  const dps = c.wants.find((w) => 'dps' in w)
  const wants = BUILDS.find((b) => b.id === c.build)!.slots[c.slot]!.wants
  const dpsTotals = dps && 'dps' in dps ? dpsBar(any, dps.dps, DPS_STATS.filter((s) => (wants[s] ?? 0) >= 0.7), 1) : undefined
  const base = c.base ?? totals?.top ?? dpsTotals?.top ?? any
  const item = newItem(base, 84, { s: 1 })
  const tags = itemTags(item)
  const ids: string[] = [...(caring(c) ? totals?.mods ?? [] : []), ...(dpsTotals?.mods ?? [])]
  for (const w of c.wants) {
    if ('defence' in w || 'dps' in w) continue
    // The option giving the most of that stat at item level 84 (the asks sit inside the accepted tiers of its family).
    const most = (x: string) => Math.max(...MODS[x].stats.filter(([s]) => fillsAsk(s, w.stat, wants)).map(([, a, b]) => Math.max(Math.abs(a), Math.abs(b))))
    const id = Object.keys(MODS).filter((x) => (MODS[x].gen === 'prefix' || MODS[x].gen === 'suffix') && !MODS[x].dom && !MODS[x].essenceOnly
      && MODS[x].stats.some(([s]) => fillsAsk(s, w.stat, wants)) && MODS[x].lvl <= 84 && spawnWeight(x, tags) > 0
      && !ids.some((p) => MODS[p].grp.some((g) => MODS[x].grp.includes(g))))
      .sort((a, b) => most(b) - most(a))[0]
    ids.push(id)
  }
  // Best rolls: the top of each range (the bottom for negative stats).
  const best = (id: string) => ({ id, values: MODS[id].stats.map(([, a, b]) => (Math.max(a, b) <= 0 ? Math.min(a, b) : Math.max(a, b))) })
  return { ...item, rarity: 'rare', quality: 20, explicits: ids.map(best) }
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
  assert.equal(s.board!.length, 3)
  const c = s.board![0]
  assert.ok(c.reward > 0)
  assert.ok(c.until >= s.day)
  const item = fill(c)
  assert.ok(canDeliver(item, c))
  s = { ...s, goal: c.id, nextUid: s.nextUid + 2, stash: [{ uid: s.nextUid, item }, { uid: s.nextUid + 1, item: newItem(RING, 84, { s: 3 }) }] }
  const [good, bad] = s.stash
  const before = s
  assert.equal(deliver(s, bad.uid, c.id).ok, false, '안 맞는 아이템은 거절')
  s = ok(deliver(s, good.uid, c.id))
  assert.equal(s.pending, before.pending + c.reward)
  assert.equal(s.used, before.used + 1)
  assert.ok(!s.board!.includes(c))
  assert.equal(s.goal, undefined, '납품하면 목표 해제')
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

test('의뢰 보수 = (베이스 상점가 + 조건을 딱 채운 아이템의 옵션 가치) × 1.5, 같은 아이템을 파는 것보다 늘 많음', () => {
  for (const day of [1, 7, 12]) {
    const meta = rollMeta({ s: day })
    for (const c of refreshBoard([], day, 14, meta, { s: day * 13 })) {
      if (!c.base) continue // defence orders: see their own test
      // Each option at the worst tier that still counts, like the order's own reference item.
      const item = newItem(c.base!, 84, { s: 1 })
      const tags = itemTags(item)
      const ids: string[] = []
      const mods: RolledMod[] = []
      const wants = BUILDS.find((b) => b.id === c.build)!.slots[c.slot]!.wants
      // The elemental resistance total last: it takes what the other asks' resistances leave.
      const isTotal = (w: (typeof c.wants)[number]) => Number('stat' in w && w.stat === ELE_RES)
      for (const w of [...c.wants].sort((a, b) => isTotal(a) - isTotal(b))) {
        if ('defence' in w || 'dps' in w) continue
        const fits = Object.keys(MODS).filter((x) => (MODS[x].gen === 'prefix' || MODS[x].gen === 'suffix') && !MODS[x].dom && !MODS[x].essenceOnly
          && !MODS[x].elev && MODS[x].stats.some(([st]) => fillsAsk(st, w.stat, wants)) && MODS[x].lvl <= 84 && spawnWeight(x, tags) > 0 && tierOf(item, x) <= w.maxTier
          && !ids.some((q) => MODS[q].grp.some((g) => MODS[x].grp.includes(g))))
        const id = fits.reduce((a, x) => (tierOf(item, x) > tierOf(item, a) ? x : a))
        ids.push(id)
        // Rolled at the numbers asked, like the order's own item.
        const ele = mods.reduce((s, m) => s + MODS[m.id].stats.reduce((t, [st], i) => t + elementalCount(st) * m.values[i], 0), 0)
        mods.push({ id, values: MODS[id].stats.map(([st, a, b]) => (w.stat === ELE_RES ? w.min! - ele : st === w.stat ? w.min! : st === w.stat2 ? w.min2! : Math.min(a, b))) })
      }
      const plain: Item = { ...item, rarity: 'rare', explicits: mods }
      const q = quote(plain, 'en', day, meta)
      // Only a hybrid family picked here instead of the main one can differ from the order's own item.
      const ratio = c.reward / (COMMISSION_BONUS * (basePrice(c.base!, 84, day) + q.optionValue))
      assert.ok(ratio > 0.6 && ratio < 1.7, `${day}일차 ${c.build}: 보수 ${c.reward}, 옵션 가치 ${q.optionValue}`)
      assert.ok(c.reward > q.price, `${day}일차 ${c.build}: 보수 ${c.reward} ≤ 파우스투스 견적 ${q.price}`)
    }
  }
})

test('의뢰: 처음부터 옵션 3개, 중반(7일차)부터 4개, 빌드가 가장 좋아하는 베이스를 지정', () => {
  for (const day of [1, 3, 6, 7, 10, 14]) {
    for (let seed = 1; seed <= 4; seed++) {
      for (const c of refreshBoard([], day, 14, rollMeta({ s: seed }), { s: seed * 31 + day })) {
        const options = c.wants.filter((w) => !('defence' in w) || caring(c)).length
        const count = day >= WANTS_LATE_FROM ? 4 : 3
        // A DPS ask stands in for the damage options, so a bow order may be "elemental DPS" and little else.
        if (c.wants.some((w) => 'dps' in w)) assert.ok(options >= 1 && options <= count, `${day}일차 DPS 의뢰 조건 수 ${options}`)
        else assert.equal(options, count, `${day}일차 옵션 수`)
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

test('의뢰 옵션은 등급이 아니라 수치로: 1등급 요구는 1등급 최저치, 1–3등급 요구는 3등급 범위 안의 값', () => {
  let one = 0
  let range = 0
  for (let seed = 1; seed < 30; seed++) {
    for (const c of refreshBoard([], 7, 14, rollMeta({ s: seed }), { s: seed * 5 })) {
      for (const w of c.wants) {
        if ('defence' in w || 'dps' in w) {
          assert.equal(w.min % 10, 0, '방어·DPS 수치는 10단위')
          continue
        }
        assert.ok(w.min !== undefined, '수치로 요구')
        const item = newItem(c.base ?? buyableBases().find((b) => c.classes.includes(BASES[b].cls))!, 84, { s: 1 })
        const tags = itemTags(item)
        const of = (tier: number) => Object.keys(MODS).filter((x) => (MODS[x].gen === 'prefix' || MODS[x].gen === 'suffix') && !MODS[x].dom
          && !MODS[x].essenceOnly && MODS[x].stats.some(([st]) => st === w.stat) && MODS[x].lvl <= 84 && spawnWeight(x, tags) > 0 && tierOf(item, x) === tier)
        const span = (id: string) => { const [, a, b] = MODS[id].stats.find(([st]) => st === w.stat)!; return [Math.min(a, b), Math.max(a, b)] }
        const tier = of(w.maxTier)
        if (!tier.length || w.min === undefined || w.min < 0) continue
        const min = w.min
        if (w.maxTier === 1) {
          one++
          assert.ok(tier.some((id) => span(id)[0] === min), `1등급 최저치 ${min}`)
        } else {
          range++
          assert.ok(tier.some((id) => span(id)[0] <= min && min <= span(id)[1]), `${w.maxTier}등급 범위 안 ${min}`)
        }
      }
    }
  }
  assert.ok(one > 0 && range > 0)
})

test('원소 저항은 합계 하나로 (정의의 화염의 화염 저항만 따로): 의뢰는 모든 원소를 더한 값, 견적은 어느 원소든 같음', () => {
  const ELEMENTAL = /^(base_(fire|cold|lightning)_damage_resistance_%|base_resist_all_elements_%|(fire|cold|lightning)_and_(cold|lightning|chaos)_damage_resistance_%)$/
  for (const b of BUILDS) {
    for (const [slot, s] of Object.entries(b.slots)) {
      const own = Object.keys(s!.wants).filter((st) => ELEMENTAL.test(st))
      assert.deepEqual(own, b.id === 'righteous-fire' && ELE_RES in s!.wants ? ['base_fire_damage_resistance_%'] : [], `${b.id} ${slot}`)
    }
  }
  const mod = (stat: string) => Object.keys(MODS).find((id) => MODS[id].stats.length === 1 && MODS[id].stats[0][0] === stat && !MODS[id].dom)!
  let seen = 0
  for (let seed = 1; seed <= 40 && seen < 5; seed++) {
    for (const c of refreshBoard([], 3, 14, rollMeta({ s: seed }), { s: seed * 17 })) {
      const w = c.wants.find((x) => 'stat' in x && x.stat === ELE_RES)
      if (!w || !('stat' in w) || w.min === undefined) continue
      seen++
      const min = w.min
      const item = (parts: [string, number][]): Item => ({ ...newItem(RING, 84, { s: 1 }), rarity: 'rare', explicits: parts.map(([st, v]) => ({ id: mod(st), values: [v] })) })
      const half = Math.floor(min / 2)
      assert.ok(meetsWant(item([['base_fire_damage_resistance_%', half], ['base_cold_damage_resistance_%', min - half]]), w), `화염 + 냉기 합계 ${min}`)
      assert.ok(!meetsWant(item([['base_fire_damage_resistance_%', half], ['base_lightning_damage_resistance_%', min - half - 1]]), w), '합계 모자람')
      assert.ok(meetsWant(item([['base_resist_all_elements_%', Math.ceil(min / 3)]]), w), '모든 원소 저항은 3배')
      assert.ok(meetsWant(item([['fire_and_lightning_damage_resistance_%', Math.ceil(min / 2)]]), w), '두 원소 저항은 2배')
      assert.ok(!meetsWant(item([['base_chaos_damage_resistance_%', 999]]), w), '카오스 저항은 안 침')
    }
  }
  assert.ok(seen > 0, '원소 저항 의뢰가 나옴')
  // Quotes: cold and lightning are the same option; fire is worth at least as much (Righteous Fire puts it first).
  const coral = Object.keys(names).find((k) => names[k] === 'Coral Ring')!
  const ring = (res: string) => quote({ ...newItem(coral, 84, { s: 1 }), rarity: 'rare', explicits: [{ id: 'IncreasedLife7', values: [110] }, { id: res, values: [47] }] }, 'en', 1).optionValue
  assert.equal(ring('ColdResist8'), ring('LightningResist8'))
  assert.ok(ring('FireResist8') > ring('ColdResist8'), `화염 ${ring('FireResist8')} vs 냉기 ${ring('ColdResist8')}`)
})

test('초반 3일엔 보수 천만 이상 의뢰가 안 뜨고, 그래도 의뢰는 붙음', () => {
  for (let day = 1; day <= EARLY_DAYS; day++) {
    for (let seed = 1; seed <= 15; seed++) {
      const board = refreshBoard([], day, 14, rollMeta({ s: seed }), { s: seed * 7 + day })
      assert.ok(board.length > 0, `${day}일차 seed ${seed}: 의뢰 없음`)
      for (const c of board) assert.ok(c.reward < EARLY_REWARD_MAX, `${day}일차 ${c.build}: 보수 ${c.reward}`)
    }
  }
})

test('공격 빌드 무기 의뢰는 DPS로: 피해 옵션 대신 물리/원소/전체 DPS를 10단위로 요구하고 그 종류 무기면 아무 베이스나', () => {
  assert.equal(dpsKind(BUILDS.find((b) => b.id === 'boneshatter')!.slots.weapon!.wants), 'phys')
  assert.equal(dpsKind(BUILDS.find((b) => b.id === 'lightning-arrow')!.slots.weapon!.wants), 'ele')
  assert.equal(dpsKind(BUILDS.find((b) => b.id === 'winter-orb')!.slots.weapon!.wants), undefined, '주문 빌드는 DPS 안 봄')
  // DPS replaces damage options; with none to replace there's no DPS ask (user: it can't stand in for zero options).
  assert.equal(dpsKind({ 'local_critical_strike_chance_+%': 1, 'base_critical_strike_multiplier_+': 1 }), undefined)
  assert.equal(dpsKind(BUILDS.find((b) => b.id === 'kinetic-fusillade-ascendant-uber')!.slots.weapon!.wants), 'total', '카오스 추가 피해 마법봉')
  let seen = 0
  for (let seed = 1; seed <= 60 && seen < 3; seed++) {
    for (const c of refreshBoard([], 7, 14, rollMeta({ s: seed }), { s: seed * 11 })) {
      const w = c.wants.find((x) => 'dps' in x)
      if (!w || !('dps' in w)) continue
      seen++
      const kind = dpsKind(BUILDS.find((b) => b.id === c.build)!.slots.weapon!.wants)
      assert.equal(w.dps, kind)
      assert.ok(w.min > 0 && w.min % 10 === 0, `DPS ${w.min}`)
      assert.equal(c.base, undefined, '아무 베이스나')
      const wanted = DPS_STATS.filter((s) => (BUILDS.find((b) => b.id === c.build)!.slots.weapon!.wants[s] ?? 0) >= 0.7)
      assert.ok(wanted.length > 0, '대체할 피해 옵션이 있을 때만')
      assert.equal(c.classes.length, 1)
      // No option ask for what the DPS already covers.
      assert.ok(!c.wants.some((x) => 'stat' in x && DPS_STATS.includes(x.stat)))
      assert.ok(canDeliver(fill(c), c), `${c.build}: 채운 아이템이 통과`)
    }
  }
  assert.ok(seen > 0, 'DPS 의뢰가 나옴')
})

test('의뢰 게시판: 첫날 3건, 그 뒤 마감마다 5건까지 채움, 같은 빌드·부위 중복 없음, 삭제·만료·납품하면 목표도 해제', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let s = newGame(seed)
    assert.equal(s.board!.length, 3, '첫날 3건')
    // Drop one and set another as the goal: the board stays short until the next close, then it's full again.
    const [gone, kept] = s.board!
    s = { ...ok(dismissCommission(s, gone.id)), goal: kept.id }
    assert.equal(s.board!.length, 2)
    assert.equal(ok(dismissCommission(s, kept.id)).goal, undefined, '삭제하면 목표 해제')
    for (let day = 1; day < 6; day++) {
      s = closeDay(s)
      assert.equal(s.board!.length, 5, `${s.day}일차 5건`)
      assert.ok(s.board!.every((c) => c.reward >= MIN_REWARD), '보수 5,000 이상만')
      const keys = s.board!.map((c) => `${c.build}|${c.slot}`)
      assert.equal(new Set(keys).size, keys.length, '같은 빌드·부위 중복 없음')
      if (s.goal !== undefined) assert.ok(s.board!.some((c) => c.id === s.goal), '목표는 게시판에 있는 의뢰만')
    }
    assert.equal(s.goal, undefined, `만료된 목표 해제 (${kept.until}일까지였던 의뢰)`)
  }
})
