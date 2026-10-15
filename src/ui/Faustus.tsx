import { useMemo } from 'react'
import { BASES } from '../engine/data.ts'
import { fractured } from '../engine/item.ts'
import type { Lang } from '../game/describe.ts'
import type { StashItem } from '../game/game.ts'
import { buildName, saturation, type Meta } from '../game/meta.ts'
import { ELEVATED_SURGE, FINISHED, quote, slotOf } from '../game/value.ts'
import { fmtGold, t, tierText } from '../i18n.ts'
import { Tooltip } from './Tooltip.tsx'

interface Props {
  lang: Lang
  entry: StashItem | undefined
  day: number
  meta: Meta
  canSell: boolean
  subtitle: string | null // first-visit line
  onSell: () => void
  onBack: () => void
}

export function Faustus({ lang, entry, day, meta, canSell, subtitle, onSell, onBack }: Props) {
  const q = useMemo(() => (entry ? quote(entry.item, lang, day, meta) : null), [entry, lang, day, meta])
  const byCost = !!q && q.expectedCost > q.optionValue && (q.best?.usefulCount ?? 0) >= FINISHED && q.price > q.optionValue
  const sat = entry && q?.best ? saturation(meta, q.best.id, slotOf(BASES[entry.item.base].cls)) : 1
  const elevated = Math.min(3, q?.best?.mods.filter((m) => m.useful && m.tier === 0).length ?? 0)
  return (
    <section className="panel faustus">
      <h2>{t(lang, 'faustus')}</h2>
      {subtitle && <blockquote className="subtitle">{subtitle}</blockquote>}
      {!entry || !q ? (
        <p className="hint">{t(lang, 'selectItem')}</p>
      ) : (
        <>
          <Tooltip item={entry.item} lang={lang} />
          <div className="quote">
            <div className="quote-price">{t(lang, 'quote')}: <strong>{fmtGold(q.price)}</strong></div>
            <button className="primary" disabled={!canSell} onClick={onSell}>{t(lang, 'sell')}</button>
            <button onClick={onBack}>{t(lang, 'back')}</button>
          </div>
          <p className="hint">{t(lang, 'costNote', fmtGold(q.optionValue), fmtGold(q.expectedCost))}{byCost && <><br />{t(lang, 'costRule', FINISHED)}</>}</p>

          <h3>{t(lang, 'whoUses')}</h3>
          <ol>{q.top.map((p) => (
            <li key={p.id}>{p.name} — {fmtGold(p.value)}{p.trend && <span className={`trend ${p.trend}`}> {t(lang, p.trend === 'rising' ? 'trendRising' : 'trendFalling')}</span>}</li>
          ))}</ol>

          <h3>{t(lang, 'why')}</h3>
          {!q.best ? (
            <p>{t(lang, 'noBuyer')}</p>
          ) : (
            <>
              <p>{q.best.name} · {t(lang, 'baseFit')} {Math.round(q.best.fit * 100)}% · {t(lang, 'usefulCount', q.best.usefulCount)} · {t(lang, 'completeness', Math.round(q.best.completeness * 100))} · {t(lang, 'baseQuality', Math.round(q.best.baseQuality * 100))}</p>
              <p className="hint">{t(lang, 'synergyNote')}</p>
              {q.best.usefulCount === 1 && <p className="hint">{t(lang, 'singleNote')}</p>}
              {elevated > 0 && <p className="hint">{t(lang, 'elevatedNote', elevated, ELEVATED_SURGE[elevated])}</p>}
              <ul className="verdicts">
                {q.best.mods.map((m) => (
                  <li key={m.id} className={m.useful ? 'useful' : 'useless'}>
                    {m.name || m.id} · {tierText(lang, m.tier)} — {m.useful ? `${t(lang, 'usefulYes')} (${Math.round(m.contribution * 100)})` : t(lang, 'usefulNo')}{m.note && ` · ${t(lang, `note_${m.note}`)}`}
                  </li>
                ))}
              </ul>
            </>
          )}
          {q.boom > 1 && <p className="boom">{t(lang, 'boomNote', Math.round((q.boom - 1) * 100))}</p>}
          {sat < 1 && <p className="hint">{t(lang, 'saturationNote', Math.round((1 - sat) * 100))}</p>}
          {q.baseResale > 0 && <p className="hint">{t(lang, fractured(entry.item) ? 'baseResaleFractured' : 'baseResale', fmtGold(q.baseResale))}</p>}

          {meta.notes.length > 0 && (
            <>
              <h3>{t(lang, 'patchNotes')}</h3>
              <ul className="patch-notes">
                {meta.notes.map((n, i) => (
                  <li key={i}>{t(lang, 'dayShort', n.day)} {buildName(n.build, lang)} — {t(lang, n.factor > 1 ? 'patchBuff' : 'patchNerf')}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
