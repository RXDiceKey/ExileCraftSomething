// Commission board (D38) and rumors about the coming patches.
import { canDeliver, type Commission } from '../game/commissions.ts'
import { className, defenceName, statLabel, type Lang } from '../game/describe.ts'
import type { StashItem } from '../game/game.ts'
import { buildName, type Meta } from '../game/meta.ts'
import { fmtGold, t } from '../i18n.ts'

interface Props {
  lang: Lang
  board: Commission[]
  meta: Meta
  entry: StashItem | undefined
  canSell: boolean
  onDeliver: (id: number) => void
}

export function Board({ lang, board, meta, entry, canSell, onDeliver }: Props) {
  return (
    <section className="panel board">
      <h2>{t(lang, 'board')}</h2>
      <p className="hint">{t(lang, 'boardNote')}</p>
      {!board.length && <p>{t(lang, 'boardEmpty')}</p>}
      <ul className="commissions">
        {board.map((c) => {
          const fits = !!entry && canDeliver(entry.item, c)
          return (
            <li key={c.id}>
              <div>
                <b>{buildName(c.build, lang)}</b> — {c.classes.map((x) => className(x, lang)).join('·')}
                {c.defence && ` (${c.defence.map((d) => defenceName(d, lang)).join('/')})`}
              </div>
              <ul>
                {c.wants.map((w) => (
                  <li key={w.stat}>{statLabel(w.stat, lang)?.[1] ?? w.stat} · {w.maxTier > 1 ? t(lang, 'tierRange', w.maxTier) : t(lang, 'tier', 1)}</li>
                ))}
              </ul>
              <div className="commission-foot">
                {t(lang, 'commissionUntil', c.until)} · {t(lang, 'commissionReward')} <b className="gold">{fmtGold(c.reward)}</b>
                <button className="primary" disabled={!fits || !canSell} onClick={() => onDeliver(c.id)}>{t(lang, 'deliver')}</button>
                {entry && !fits && <span className="hint">{t(lang, 'notFit')}</span>}
              </div>
            </li>
          )
        })}
      </ul>

      <h3>{t(lang, 'rumors')}</h3>
      {meta.rumors?.length ? (
        <ul>
          {meta.rumors.map((r) => (
            <li key={`${r.day}-${r.note.build}`}>
              {t(lang, 'rumorLine', r.day, buildName(r.note.build, lang), r.note.day, t(lang, r.note.factor > 1 ? 'patchBuff' : 'patchNerf'))}
            </li>
          ))}
        </ul>
      ) : <p className="hint">{t(lang, 'noRumors')}</p>}
    </section>
  )
}
