import type { Lang } from '../game/describe.ts'
import type { Rival, RivalNews } from '../game/rivals.ts'
import { fmtGold, t, type StringKey } from '../i18n.ts'

export const rivalName = (lang: Lang, r: { kind: string }) => t(lang, `rival_${r.kind}` as StringKey)
export const rivalNewsText = (lang: Lang, n: RivalNews) =>
  t(lang, `rivalNews_${n.event}` as StringKey, rivalName(lang, n), fmtGold(n.amount))

interface Row { key: string; name: string; note: string; gold: number; prev?: number }
// Everyone by gold, the player included (their pending sales count: rivals' gold is after their sales too).
export function rankRows(lang: Lang, gold: number, rivals: Rival[]): Row[] {
  return [
    { key: 'you', name: t(lang, 'you'), note: '', gold },
    ...rivals.map((r) => ({ key: r.kind, name: rivalName(lang, r), note: t(lang, `rivalKind_${r.kind}` as StringKey), gold: r.gold, prev: r.prev })),
  ].sort((a, b) => b.gold - a.gold)
}

export function Rivals({ lang, gold, rivals }: { lang: Lang; gold: number; rivals: Rival[] }) {
  return (
    <section className="panel rivals">
      <h3>{t(lang, 'rivals')}</h3>
      <ol>
        {rankRows(lang, gold, rivals).map((r) => (
          <li key={r.key} className={r.key === 'you' ? 'you' : ''}>
            <span>{r.name}{r.note && <small> · {r.note}</small>}</span>
            <b>{fmtGold(r.gold)}</b>
            {r.prev !== undefined && r.prev !== r.gold && (
              <small className={r.gold > r.prev ? 'up' : 'down'}>{r.gold > r.prev ? '▲' : '▼'}{Math.abs(Math.round((r.gold / r.prev - 1) * 100))}%</small>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
