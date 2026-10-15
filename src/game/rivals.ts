// Trade rivals: three merchants who never craft. Each day close their gold just moves by personality, so the player has
// someone to race without the game simulating crafting (D34). Shown as a ranking; the run ends with final places.
import { next, type Rng } from '../engine/rng.ts'

export type RivalKind = 'highroller' | 'gambler' | 'shadow'
export interface Rival { kind: RivalKind; gold: number; prev: number }
export type RivalEvent = 'jackpot' | 'bigWin' | 'bigLoss' | 'overtake' | 'close'
export interface RivalNews { kind: RivalKind; event: RivalEvent; amount: number }

export const RIVAL_KINDS: RivalKind[] = ['highroller', 'gambler', 'shadow']
export const newRivals = (start: number): Rival[] => RIVAL_KINDS.map((kind) => ({ kind, gold: start, prev: start }))

const gauss = (rng: Rng) => Math.sqrt(-2 * Math.log(1 - next(rng))) * Math.cos(2 * Math.PI * next(rng))
const between = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * next(rng)

// ponytail: personalities as daily log-returns, set by feel; retune once real player results are known.
// High roller (sells the top end): steady +~14%/day and an occasional big sale: about x10 over a run (10%-90%: x5-x25).
export const HIGHROLLER = { drift: 0.13, spread: 0.08, jackpot: 0.08, jackpotGain: [0.3, 0.7] as const }
// Gambler: wild swings both ways, slight upward drift (about x2, 10%-90%: x0.5-x8); never quite broke (keeps a tenth).
export const GAMBLER = { drift: 0.05, spread: 0.3, floor: 0.1 }
// Shadow (follows the player): closes 60% of the gap to the player's gold times 0.85-1.12 every day.
export const SHADOW = { lag: 0.6, band: [0.85, 1.12] as const }

export function advanceRivals(rivals: Rival[], playerGold: number, start: number, rng: Rng): { rivals: Rival[]; news: RivalNews[] } {
  const news: RivalNews[] = []
  const out = rivals.map((r): Rival => {
    let gold = r.gold
    if (r.kind === 'highroller') {
      let g = HIGHROLLER.drift + HIGHROLLER.spread * gauss(rng)
      if (next(rng) < HIGHROLLER.jackpot) {
        const extra = between(rng, ...HIGHROLLER.jackpotGain)
        g += extra
        news.push({ kind: r.kind, event: 'jackpot', amount: Math.round(gold * (Math.exp(g) - 1)) })
      }
      gold *= Math.exp(g)
    } else if (r.kind === 'gambler') {
      const g = GAMBLER.drift + GAMBLER.spread * gauss(rng)
      const after = Math.max(start * GAMBLER.floor, gold * Math.exp(g))
      if (g > 0.35) news.push({ kind: r.kind, event: 'bigWin', amount: Math.round(after - gold) })
      if (g < -0.3) news.push({ kind: r.kind, event: 'bigLoss', amount: Math.round(gold - after) })
      gold = after
    } else {
      const target = playerGold * between(rng, ...SHADOW.band)
      const after = gold + SHADOW.lag * (target - gold)
      if (gold < playerGold && after >= playerGold) news.push({ kind: r.kind, event: 'overtake', amount: Math.round(after - playerGold) })
      else if (after < playerGold && after > playerGold * 0.95 && gold < playerGold * 0.95) news.push({ kind: r.kind, event: 'close', amount: Math.round(playerGold - after) })
      gold = after
    }
    return { kind: r.kind, prev: r.gold, gold: Math.round(gold) }
  })
  return { rivals: out, news }
}

// 1-based place of the player among everyone (ties go to the player).
export const playerRank = (playerGold: number, rivals: Rival[]) => 1 + rivals.filter((r) => r.gold > playerGold).length
