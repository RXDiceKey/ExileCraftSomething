// Rival names, news lines and the ranking rows (shared by the rivals panel and the run-over screen).
import type { Lang } from '../game/describe.ts'
import type { Rival, RivalNews } from '../game/rivals.ts'
import { fmtGold, t, type StringKey } from '../i18n.ts'

export const rivalName = (lang: Lang, r: { kind: string }) => t(lang, `rival_${r.kind}` as StringKey)
export const rivalNewsText = (lang: Lang, n: RivalNews) =>
  t(lang, `rivalNews_${n.event}` as StringKey, rivalName(lang, n), fmtGold(n.amount))

interface Row { key: string; name: string; gold: number; prev?: number }
// Everyone by gold, the player included (their pending sales count: rivals' gold is after their sales too).
export function rankRows(lang: Lang, gold: number, rivals: Rival[]): Row[] {
  return [
    { key: 'you', name: t(lang, 'you'), gold },
    ...rivals.map((r) => ({ key: r.kind, name: rivalName(lang, r), gold: r.gold, prev: r.prev })),
  ].sort((a, b) => b.gold - a.gold)
}
