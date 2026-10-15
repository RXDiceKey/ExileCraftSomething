import { useMemo } from 'react'
import { BASES } from '../engine/data.ts'
import { fractured } from '../engine/item.ts'
import type { Lang } from '../game/describe.ts'
import type { StashItem } from '../game/game.ts'
import { buildName, saturation, type Meta } from '../game/meta.ts'
import { ELEVATED_SURGE, quote, slotOf } from '../game/value.ts'
import { fmtGold, t, tierText } from '../i18n.ts'
import { Tooltip } from './Tooltip.tsx'

interface Props {
  lang: Lang
  entry: StashItem | undefined
  day: number
  meta: Meta
  canSell: boolean
  lit: boolean | null // search highlight on the item
  onSell: () => void
  onBack: () => void
}

// The quote, who pays it, and only what moves the price (user: no other explanation anywhere).
export function Faustus({ lang, entry, day, meta, canSell, lit, onSell, onBack }: Props) {
  const q = useMemo(() => (entry ? quote(entry.item, lang, day, meta) : null), [entry, lang, day, meta])
  const sat = entry && q?.best ? saturation(meta, q.best.id, slotOf(BASES[entry.item.base].cls)) : 1
  const elevated = Math.min(3, q?.best?.mods.filter((m) => m.useful && m.tier === 0).length ?? 0)
  return (
    <section className="panel faustus">
      <h2>{t(lang, 'faustus')}</h2>
      {!entry || !q ? (
        <p className="hint">{t(lang, 'selectItem')}</p>
      ) : (
        <>
          <Tooltip item={entry.item} lang={lang} lit={lit} />
          <div className="quote">
            <div className="quote-price">{t(lang, 'quote')}: <strong>{fmtGold(q.price)}</strong></div>
            <button className="primary" disabled={!canSell} onClick={onSell}>{t(lang, 'sell')}</button>
            <button onClick={onBack}>{t(lang, 'back')}</button>
          </div>

          {q.top.length > 0 && (
            <>
              <h3>{t(lang, 'whoUses')}</h3>
              <ol>{q.top.map((p) => (
                <li key={p.id}>{p.name} — {fmtGold(p.value)}{p.trend && <span className={`trend ${p.trend}`}> {t(lang, p.trend === 'rising' ? 'trendRising' : 'trendFalling')}</span>}</li>
              ))}</ol>
            </>
          )}

          <h3>{t(lang, 'why')}</h3>
          {!q.best ? <p>{t(lang, 'noBuyer')}</p> : (
            <ul className="verdicts">
              {q.best.mods.map((m) => <li key={m.id} className={m.useful ? 'useful' : 'useless'}>{m.name || m.id} · {tierText(lang, m.tier)}</li>)}
            </ul>
          )}
          <ul className="price-factors">
            {elevated > 0 && <li>{t(lang, 'elevatedNote', elevated, ELEVATED_SURGE[elevated])}</li>}
            {q.boom > 1 && <li className="boom">{t(lang, 'boomNote', Math.round((q.boom - 1) * 100))}</li>}
            {sat < 1 && <li>{t(lang, 'saturationNote', Math.round((1 - sat) * 100))}</li>}
            {q.price === q.baseResale && <li>{t(lang, fractured(entry.item) ? 'baseResaleFractured' : 'baseResale')}</li>}
          </ul>

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
