import type { Lang } from '../game/describe.ts'
import type { Rival } from '../game/rivals.ts'
import { fmtGold, t } from '../i18n.ts'
import { rankRows } from './rivalText.ts'

// Ranked by gold including tomorrow's payouts; the player's row shows "gold now (with tomorrow's)" (user).
export function Rivals({ lang, gold, pending, rivals }: { lang: Lang; gold: number; pending: number; rivals: Rival[] }) {
  return (
    <section className="panel rivals">
      <h3>{t(lang, 'rivals')}</h3>
      <ol>
        {rankRows(lang, gold + pending, rivals).map((r) => (
          <li key={r.key} className={r.key === 'you' ? 'you' : ''}>
            <span>{r.name}</span>
            <b>{r.key === 'you' && pending > 0 ? `${fmtGold(gold)} (${fmtGold(r.gold)})` : fmtGold(r.gold)}</b>
            {r.prev !== undefined && r.prev !== r.gold && (
              <small className={r.gold > r.prev ? 'up' : 'down'}>{r.gold > r.prev ? '▲' : '▼'}{Math.abs(Math.round((r.gold / r.prev - 1) * 100))}%</small>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
