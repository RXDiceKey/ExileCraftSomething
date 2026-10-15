// Commission board (D38) and rumors about the coming patches.
import { canDeliver, type Commission } from '../game/commissions.ts'
import { baseArt, baseName, className, defenceName, statLabel, statLine, type Lang } from '../game/describe.ts'
import type { StashItem } from '../game/game.ts'
import { buildName, type Meta } from '../game/meta.ts'
import { fmtGold, t } from '../i18n.ts'

interface Props {
  lang: Lang
  board: Commission[]
  day: number
  meta: Meta
  entry: StashItem | undefined
  canSell: boolean
  onDeliver: (id: number) => void
}

export function Board({ lang, board, day, meta, entry, canSell, onDeliver }: Props) {
  return (
    <section className="panel board">
      <h2>{t(lang, 'board')}</h2>
      {!board.length && <p>{t(lang, 'boardEmpty')}</p>}
      <ul className="commissions">
        {board.map((c) => {
          const fits = !!entry && canDeliver(entry.item, c)
          return (
            <li key={c.id}>
              <div>
                <b>{buildName(c.build, lang)}</b> — {c.base
                  ? <><img className="inline-icon" src={`${import.meta.env.BASE_URL}${baseArt(c.base)}`} alt="" /> {baseName(c.base, lang)} <span className="hint">({t(lang, 'commissionOptions', c.wants.length)})</span></>
                  : <>{c.classes.map((x) => className(x, lang)).join('·')}{c.defence && ` (${c.defence.map((d) => defenceName(d, lang)).join('/')})`}</>}
              </div>
              <ul>
                {c.wants.map((w) => ('defence' in w
                  ? <li key={w.defence}>{defenceName(w.defence, lang)} {t(lang, 'atLeast', w.min)}</li>
                  : <li key={w.stat}>{w.min === undefined
                    ? <>{statLabel(w.stat, lang)?.[1] ?? w.stat} · {w.maxTier > 1 ? t(lang, 'tierRange', w.maxTier) : t(lang, 'tier', 1)}</>
                    : <AskLine lang={lang} values={{ [w.stat]: w.min, ...(w.stat2 && { [w.stat2]: w.min2! }) }} />}</li>))}
              </ul>
              <div className="commission-foot">
                {t(lang, 'commissionLeft', c.until - day + 1)} · {t(lang, 'commissionReward')} <b className="gold">{fmtGold(c.reward)}</b>
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

// A number asked of an option. A line that shows the value with its minus sign ("-7 to Total Mana Cost") is met by going
// lower; one that turns it into a reduction ("18% reduced") reads as a size, so "or more".
function AskLine({ lang, values }: { lang: Lang; values: Record<string, number> }) {
  const line = statLine(values, lang)
  return <>{line} {t(lang, /-\d/.test(line) ? 'atMost' : 'atLeast', '').trim()}</>
}
