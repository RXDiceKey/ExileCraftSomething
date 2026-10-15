import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closeDay, LAST_DAY, newGame, START_GOLD } from './game.ts'
import { advanceRivals, GAMBLER, newRivals, playerRank, type Rival } from './rivals.ts'

// One run of daily closes against a player whose gold is fixed; returns the rivals' final gold.
function finish(seed: number, playerGold: number): Rival[] {
  let rivals = newRivals(START_GOLD)
  const rng = { s: seed }
  for (let d = 1; d <= LAST_DAY; d++) rivals = advanceRivals(rivals, playerGold, START_GOLD, rng).rivals
  return rivals
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

test('경쟁 상인: 큰손은 꾸준히 크게, 도박꾼은 들쭉날쭉, 그림자는 나를 따라옴', () => {
  const runs = Array.from({ length: 300 }, (_, k) => finish(k, START_GOLD * 3))
  const gold = (kind: string) => runs.map((rs) => rs.find((r) => r.kind === kind)!.gold)
  const high = gold('highroller')
  assert.ok(median(high) > START_GOLD * 6, `큰손 중앙값 ${median(high) / START_GOLD}배`)
  assert.ok(high.every((g) => g > START_GOLD), '큰손은 거의 늘기만 함')
  const gamble = gold('gambler')
  assert.ok(gamble.some((g) => g < START_GOLD * 0.7) && gamble.some((g) => g > START_GOLD * 3), '도박꾼은 크게 잃기도 따기도')
  assert.ok(gamble.every((g) => g >= START_GOLD * GAMBLER.floor), '바닥까지 가진 않음')
  for (const g of gold('shadow')) assert.ok(g > START_GOLD * 3 * 0.8 && g < START_GOLD * 3 * 1.15, `그림자 ${g}`)
  assert.equal(playerRank(10, [{ kind: 'gambler', gold: 20, prev: 0 }, { kind: 'shadow', gold: 5, prev: 0 }]), 2)
})

test('하루 마감에 경쟁 상인도 움직이고, 마지막 날까지 반영', () => {
  let s = newGame(5)
  assert.equal(s.rivals.length, 3)
  s = closeDay(s)
  assert.ok(s.rivals.some((r) => r.gold !== START_GOLD), '첫 마감에 골드가 움직임')
  assert.ok(Array.isArray(s.rivalNews))
  while (!s.finished) s = closeDay(s)
  assert.equal(s.day, LAST_DAY)
  assert.ok(s.rivals.every((r) => r.prev !== undefined))
})
