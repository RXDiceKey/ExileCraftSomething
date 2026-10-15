import assert from 'node:assert/strict'
import { test } from 'node:test'
import textEn from '../data/text.en.json' with { type: 'json' }
import { BASES, MODS } from '../engine/data.ts'
import { itemTags, newItem, rollMod, spawnWeight, type Item } from '../engine/item.ts'
import { canDeliver, rewardScale, type Commission } from './commissions.ts'
import { baseKindKeys, tierOf } from './describe.ts'
import { buyBase, closeDay, deliver, newGame, sell, doCurrency, type GameState, type Result } from './game.ts'
import { advanceMeta, BUILDS, rollMeta, RUMOR_LEAD, saturate, saturation } from './meta.ts'
import { buyableBases } from './shop.ts'
import { quote, slotOf } from './value.ts'

const ok = <T>(r: Result<T>): T => { assert.ok(r.ok, r.ok ? '' : r.error); return r.state }
const names = (textEn as { bases: Record<string, string> }).bases
const RING = Object.keys(names).find((k) => names[k] === 'Two-Stone Ring')!

// The plainest item that fills a commission (first fitting base, worst tier that still counts).
function fill(c: Commission): Item {
  const base = buyableBases().find((b) => c.classes.includes(BASES[b].cls)
    && (!c.defence || c.defence.some((d) => baseKindKeys(b).defences.includes(d))))!
  const item = newItem(base, 84, { s: 1 })
  const tags = itemTags(item)
  const ids: string[] = []
  for (const w of c.wants) {
    const id = Object.keys(MODS).find((x) => (MODS[x].gen === 'prefix' || MODS[x].gen === 'suffix') && !MODS[x].dom && !MODS[x].essenceOnly
      && MODS[x].stats.some(([s]) => s === w.stat) && MODS[x].lvl <= 84 && spawnWeight(x, tags) > 0 && tierOf(item, x) <= w.maxTier
      && !ids.some((p) => MODS[p].grp.some((g) => MODS[x].grp.includes(g))))!
    ids.push(id)
  }
  return { ...item, rarity: 'rare', explicits: ids.map((id) => rollMod(id, { s: 2 })) }
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

test('의뢰 보수: 초반엔 낮고 뒤로 갈수록 높음 (1일차 ×0.6 → 14일차 ×1.5)', () => {
  assert.equal(rewardScale(1, 14), 0.6)
  assert.equal(rewardScale(14, 14), 1.5)
  assert.ok(Math.abs(rewardScale(7, 14) - (0.6 + 0.9 * 6 / 13)) < 1e-12)
  assert.ok(rewardScale(5, 14) < rewardScale(6, 14))
})
