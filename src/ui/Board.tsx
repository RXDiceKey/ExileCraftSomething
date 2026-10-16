// Commission board (D38) and rumors about the coming patches.
import type { Item } from '../engine/item.ts'
import { baseFits, canDeliver, meetsWant, type Commission, type Want } from '../game/commissions.ts'

const wantKey = (w: Want) => ('defence' in w ? w.defence : 'dps' in w ? `dps-${w.dps}` : w.stat)
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
  goal: number | undefined
  onDeliver: (id: number) => void
  onGoal: (id: number | undefined) => void
  onDismiss: (id: number) => void
}

export function Board({ lang, board, day, meta, entry, canSell, goal, onDeliver, onGoal, onDismiss }: Props) {
  return (
    <section className="panel board">
      <h2>{t(lang, 'board')}</h2>
      {!board.length && <p>{t(lang, 'boardEmpty')}</p>}
      <ul className="commissions">
        {board.map((c) => {
          const fits = !!entry && canDeliver(entry.item, c)
          return (
            <li key={c.id} className={goal === c.id ? 'goal-on' : undefined}>
              <div>
                <b>{buildName(c.build, lang)}</b> — <OrderBase lang={lang} c={c} />
              </div>
              <ul>{c.wants.map((w) => <li key={wantKey(w)}><WantText lang={lang} w={w} /></li>)}</ul>
              <div className="commission-foot">
                {t(lang, 'commissionLeft', c.until - day + 1)} · {t(lang, 'commissionReward')} <b className="gold">{fmtGold(c.reward)}</b>
                <button className="primary" disabled={!fits || !canSell} onClick={() => onDeliver(c.id)}>{t(lang, 'deliver')}</button>
                <button onClick={() => onGoal(goal === c.id ? undefined : c.id)}>{t(lang, goal === c.id ? 'clearGoal' : 'setGoal')}</button>
                <button className="dismiss" onClick={() => onDismiss(c.id)}>{t(lang, 'dismiss')}</button>
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

// The goal set on the board, folded above the item being crafted (user: no more going back and forth to the board):
// each condition ticked or not for the selected item.
export function GoalCard({ lang, c, item, day, open, onToggle }: {
  lang: Lang; c: Commission; item: Item | undefined; day: number; open: boolean; onToggle: (open: boolean) => void
}) {
  const base = !!item && baseFits(item, c)
  const wants = c.wants.map((w) => !!item && meetsWant(item, w))
  const met = [base, ...wants].filter(Boolean).length
  return (
    <details className="goal" open={open} onToggle={(e) => { if (e.currentTarget.open !== open) onToggle(e.currentTarget.open) }}>
      <summary>
        {t(lang, 'goal')}: <b>{buildName(c.build, lang)}</b> · {met}/{wants.length + 1} · <span className="gold">{fmtGold(c.reward)}</span>
        {' '}· {t(lang, 'commissionLeft', c.until - day + 1)}
      </summary>
      <ul className="goal-checks">
        <li className={base ? 'ok' : undefined}><OrderBase lang={lang} c={c} /></li>
        {c.wants.map((w, k) => <li key={wantKey(w)} className={wants[k] ? 'ok' : undefined}><WantText lang={lang} w={w} /></li>)}
      </ul>
    </details>
  )
}

function OrderBase({ lang, c }: { lang: Lang; c: Commission }) {
  return c.base
    ? <><img className="inline-icon" src={`${import.meta.env.BASE_URL}${baseArt(c.base)}`} alt="" /> {baseName(c.base, lang)} <span className="hint">({t(lang, 'commissionOptions', c.wants.length)})</span></>
    : <>{c.classes.map((x) => className(x, lang)).join('·')}{c.defence && ` (${c.defence.map((d) => defenceName(d, lang)).join('/')})`}</>
}

function WantText({ lang, w }: { lang: Lang; w: Want }) {
  if ('defence' in w) return <>{defenceName(w.defence, lang)} {t(lang, 'atLeast', w.min)}</>
  if ('dps' in w) return <>{t(lang, `dps_${w.dps}`)} {t(lang, 'atLeast', w.min)}</>
  if (w.min === undefined) return <>{statLabel(w.stat, lang)?.[1] ?? w.stat} · {w.maxTier > 1 ? t(lang, 'tierRange', w.maxTier) : t(lang, 'tier', 1)}</>
  return <AskLine lang={lang} values={{ [w.stat]: w.min, ...(w.stat2 && { [w.stat2]: w.min2! }) }} />
}

// A number asked of an option. A line that shows the value with its minus sign ("-7 to Total Mana Cost") is met by going
// lower; one that turns it into a reduction ("18% reduced") reads as a size, so "or more".
function AskLine({ lang, values }: { lang: Lang; values: Record<string, number> }) {
  const line = statLine(values, lang)
  return <>{line} {t(lang, /-\d/.test(line) ? 'atMost' : 'atLeast', '').trim()}</>
}
