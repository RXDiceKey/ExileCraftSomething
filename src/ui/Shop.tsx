import { useMemo, useState } from 'react'
import { BASES } from '../engine/data.ts'
import { baseArt, baseKind, baseName, className, type Lang } from '../game/describe.ts'
import type { GameState } from '../game/game.ts'
import { basePrice, buyableBases } from '../game/shop.ts'
import { fmtGold, t } from '../i18n.ts'

const CLASSES = [...new Set(Object.values(BASES).map((b) => b.cls))]

interface Props {
  lang: Lang
  state: GameState
  onBuy: (base: string, ilvl: number) => void
}

export function Shop({ lang, state, onBuy }: Props) {
  const [cls, setCls] = useState('Body Armour')
  const [query, setQuery] = useState('')
  const [ilvl, setIlvl] = useState(84)

  const rows = useMemo(() => buyableBases()
    .filter((id) => (cls === '' || BASES[id].cls === cls) && baseName(id, lang).toLowerCase().includes(query.toLowerCase()))
    .map((id) => ({ id, price: basePrice(id, ilvl, state.day) }))
    .sort((a, b) => BASES[b.id].lvl - BASES[a.id].lvl), [cls, query, ilvl, lang, state.day])

  return (
    <section className="panel shop">
      <h2>{t(lang, 'shop')}</h2>
      <p className="hint">{t(lang, 'premiumNote')}</p>

      <div className="shop-filters">
        <select value={cls} onChange={(e) => setCls(e.target.value)}>
          <option value="">{t(lang, 'allClasses')}</option>
          {CLASSES.map((c) => <option key={c} value={c}>{className(c, lang)}</option>)}
        </select>
        <input value={query} placeholder={t(lang, 'baseSearch')} onChange={(e) => setQuery(e.target.value)} />
        <label>
          {t(lang, 'itemLevel')}{' '}
          <input type="number" min={1} max={86} value={ilvl} onChange={(e) => setIlvl(Math.min(86, Math.max(1, Math.round(+e.target.value))))} />
        </label>
      </div>

      <ul className="bases">
        {rows.map(({ id, price }) => (
          <li key={id}>
            <img src={`${import.meta.env.BASE_URL}${baseArt(id)}`} alt="" loading="lazy" />
            <span className="base-name">
              {baseName(id, lang)}
              <small>{className(BASES[id].cls, lang)} · {baseKind(id, lang) || '—'} · lv {BASES[id].lvl}</small>
            </span>
            <button disabled={price > state.gold} onClick={() => onBuy(id, ilvl)}>{t(lang, 'buy')} {fmtGold(price)}</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
