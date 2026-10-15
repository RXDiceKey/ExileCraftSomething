import type { Lang } from '../game/describe.ts'
import type { Rival } from '../game/rivals.ts'
import { fmtGold, t } from '../i18n.ts'
import { rankRows } from './rivalText.ts'

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
