// P7 headless economy simulator: runs representative crafting strategies through the game's own actions (same costs and
// rules as a player clicking) and prints, in Korean, what they cost against what Faustus pays.
// Run: node scripts/sim.ts [runs=300]
import textEn from '../src/data/text.en.json' with { type: 'json' }
import { applyBench, benchOptions, CRAFTING } from '../src/engine/crafting.ts'
import { MODS } from '../src/engine/data.ts'
import type { Item } from '../src/engine/item.ts'
import { tierOf } from '../src/game/describe.ts'
import {
  buyBase, newGame, doBench, doCurrency, doEssence, doEldritchImplicit, doFossils, doHarvest, doInfluenceExalt, type GameState, type Result,
} from '../src/game/game.ts'
import { GOLD_PER_CHAOS } from '../src/game/shop.ts'
import { quote } from '../src/game/value.ts'

const RUNS = Number(process.argv[2] ?? 300)
const DAY = 7 // high-ilvl premium is over, weekend boom not yet
const ILVL = 84
const names = (textEn as { bases: Record<string, string> }).bases
const baseId = (n: string) => { const id = Object.keys(names).find((k) => names[k] === n); if (!id) throw new Error(n); return id }

interface Run { s: GameState; uid: number }
const item = (r: Run) => r.s.stash.find((x) => x.uid === r.uid)!.item
const price = (r: Run) => quote(item(r), 'ko', DAY).price
const step = (r: Run, res: Result) => { if (res.ok) r.s = res.state; return res.ok }

// One strategy = a base and what to do to it. `stop` decides when a spam loop is happy (quote target) or out of budget.
interface Strategy { name: string; base: string; act: (r: Run, spent: () => number) => void }
const target = (chaos: number) => chaos * GOLD_PER_CHAOS
const spam = (r: Run, spent: () => number, once: () => boolean, goal: number, budget: number) => {
  while (spent() < target(budget) && price(r) < target(goal)) if (!once()) break
}
const wanted = (i: Item, stat: string, maxTier: number) =>
  i.explicits.some((m) => MODS[m.id].stats.some(([s]) => s === stat) && tierOf(i, m.id) <= maxTier)
// How many good options the best buyer sees (S = completeness x 6); a player stops rolling once this is high enough.
const goodness = (r: Run) => (quote(item(r), 'ko', DAY).best?.completeness ?? 0) * 6
const until = (r: Run, spent: () => number, once: () => boolean, s: number, budget: number) => {
  while (spent() < target(budget) && goodness(r) < s) if (!once()) break
}
// Finish on the bench: the craft that raises the quote the most over its cost, if any does.
function benchFinish(r: Run) {
  const before = price(r)
  let best = -1, gain = 0
  for (const i of benchOptions(item(r))) {
    const g = quote(applyBench(item(r), i, { s: 1 }), 'ko', DAY).price - before - CRAFTING.bench[i].cost
    if (g > gain) { gain = g; best = i }
  }
  if (best >= 0) step(r, doBench(r.s, r.uid, best))
}

const STRATEGIES: Strategy[] = [
  { name: '베이스 사서 되팔기 (기준)', base: 'Vaal Regalia', act: () => {} },
  { name: '연금술 1번 (갑옷)', base: 'Vaal Regalia', act: (r) => { step(r, doCurrency(r.s, r.uid, 'alchemy')) } },
  { name: '연금술 1번 (반지)', base: 'Two-Stone Ring', act: (r) => { step(r, doCurrency(r.s, r.uid, 'alchemy')) } },
  {
    name: '카오스 연타 → 50c 이상 (반지, 예산 100c)', base: 'Two-Stone Ring',
    act: (r, spent) => { step(r, doCurrency(r.s, r.uid, 'alchemy')); spam(r, spent, () => step(r, doCurrency(r.s, r.uid, 'chaos')), 50, 100) },
  },
  {
    name: '카오스 연타 → 50c 이상 (ES 갑옷, 예산 100c)', base: 'Vaal Regalia',
    act: (r, spent) => { step(r, doCurrency(r.s, r.uid, 'alchemy')); spam(r, spent, () => step(r, doCurrency(r.s, r.uid, 'chaos')), 50, 100) },
  },
  {
    name: '변화 스팸 → 생명력 1–2등급 → 제왕 → 엑잘 채우기 (반지)', base: 'Two-Stone Ring',
    act: (r, spent) => {
      step(r, doCurrency(r.s, r.uid, 'transmutation'))
      while (spent() < target(60) && !wanted(item(r), 'base_maximum_life', 2)) step(r, doCurrency(r.s, r.uid, 'alteration'))
      step(r, doCurrency(r.s, r.uid, 'regal'))
      while (step(r, doCurrency(r.s, r.uid, 'exalted')));
    },
  },
  {
    name: '절규 탐욕 에센스 연타 → 50c 이상 (갑옷, 예산 150c)', base: 'Vaal Regalia',
    act: (r, spent) => spam(r, spent, () => step(r, doEssence(r.s, r.uid, 'Deafening Essence of Greed')), 50, 150),
  },
  {
    name: '원시 화석 연타 → 50c 이상 (방어도 갑옷, 예산 150c)', base: 'Glorious Plate',
    act: (r, spent) => spam(r, spent, () => step(r, doFossils(r.s, r.uid, ['Pristine Fossil'])), 50, 150),
  },
  {
    name: '하베스트 생명력 재련 연타 → 50c 이상 (갑옷, 예산 150c)', base: 'Vaal Regalia',
    act: (r, spent) => { step(r, doCurrency(r.s, r.uid, 'alchemy')); spam(r, spent, () => step(r, doHarvest(r.s, r.uid, 'ReforgeLife')), 50, 150) },
  },
  // ---- How a player who knows what they want plays: stop once enough good options line up, then finish on the bench.
  {
    name: '[실력] 카오스 → 좋은 옵션 S≥2.5에서 멈춤 → 작업대 (ES 갑옷, 예산 100c)', base: 'Vaal Regalia',
    act: (r, spent) => {
      step(r, doCurrency(r.s, r.uid, 'alchemy'))
      until(r, spent, () => step(r, doCurrency(r.s, r.uid, 'chaos')), 2.5, 100)
      benchFinish(r)
    },
  },
  {
    name: '[실력] 절망 에센스(ES) → S≥2.5 멈춤 → 작업대 (ES 갑옷, 예산 100c)', base: 'Vaal Regalia',
    act: (r, spent) => { until(r, spent, () => step(r, doEssence(r.s, r.uid, 'Deafening Essence of Woe')), 2.5, 100); benchFinish(r) },
  },
  {
    name: '[실력] 탐욕 에센스(생명력) → S≥2.5 멈춤 → 작업대 (방어도 갑옷, 예산 100c)', base: 'Glorious Plate',
    act: (r, spent) => { until(r, spent, () => step(r, doEssence(r.s, r.uid, 'Deafening Essence of Greed')), 2.5, 100); benchFinish(r) },
  },
  {
    name: '[실력] 변화 → 생명력·저항 둘 다 1–2등급 → 제왕 → 작업대 (반지)', base: 'Two-Stone Ring',
    act: (r, spent) => {
      step(r, doCurrency(r.s, r.uid, 'transmutation'))
      const res = (i: Item) => ['base_fire_damage_resistance_%', 'base_cold_damage_resistance_%', 'base_lightning_damage_resistance_%',
        'base_chaos_damage_resistance_%'].some((st) => wanted(i, st, 2))
      while (spent() < target(60) && !(wanted(item(r), 'base_maximum_life', 2) && res(item(r)))) {
        const a = item(r).explicits.length
        step(r, doCurrency(r.s, r.uid, a < 2 ? 'augmentation' : 'alteration'))
        if (a < 2 && !(wanted(item(r), 'base_maximum_life', 2) || res(item(r)))) step(r, doCurrency(r.s, r.uid, 'alteration'))
      }
      step(r, doCurrency(r.s, r.uid, 'regal'))
      benchFinish(r)
    },
  },
  {
    name: '[실력] 하베스트 생명력 재련 → S≥2.5 멈춤 → 작업대 (방어도 갑옷, 예산 100c)', base: 'Glorious Plate',
    act: (r, spent) => {
      step(r, doCurrency(r.s, r.uid, 'alchemy'))
      until(r, spent, () => step(r, doHarvest(r.s, r.uid, 'ReforgeLife')), 2.5, 100)
      benchFinish(r)
    },
  },
  {
    name: '연금술 → 사냥꾼 엑잘 (투구)', base: 'Hubris Circlet',
    act: (r) => { step(r, doCurrency(r.s, r.uid, 'alchemy')); step(r, doInfluenceExalt(r.s, r.uid, "Hunter's Exalted Orb")) },
  },
  {
    name: '연금술 → 우수한 불씨 (갑옷)', base: 'Vaal Regalia',
    act: (r) => { step(r, doCurrency(r.s, r.uid, 'alchemy')); step(r, doEldritchImplicit(r.s, r.uid, 'Grand Eldritch Ember')) },
  },
]

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const c = (gold: number) => (gold / GOLD_PER_CHAOS).toFixed(1)

console.log(`전략별 비용 대비 견적 (${RUNS}회씩, ${DAY}일차, 아이템 레벨 ${ILVL}, 단위: 카오스)`)
console.log(['전략', '평균 비용', '평균 견적', '견적 중앙값', '상위 10%', 'ROI', '이익 확률'].join(' | '))
for (const st of STRATEGIES) {
  const costs: number[] = []
  const quotes: number[] = []
  for (let k = 0; k < RUNS; k++) {
    const s0 = { ...newGame(1000 + k), day: DAY, gold: 1e12 }
    const bought = buyBase(s0, baseId(st.base), ILVL)
    if (!bought.ok) throw new Error(bought.error)
    const r: Run = { s: bought.state, uid: s0.nextUid }
    const spent = () => s0.gold - r.s.gold
    st.act(r, spent)
    costs.push(spent())
    quotes.push(price(r))
  }
  const roi = mean(quotes) / mean(costs)
  const win = quotes.filter((q, i) => q > costs[i]).length / RUNS
  console.log([st.name, c(mean(costs)), c(mean(quotes)), c(pct(quotes, 0.5)), c(pct(quotes, 0.9)), roi.toFixed(2), `${Math.round(win * 100)}%`].join(' | '))
}
