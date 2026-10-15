import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { BASES } from '../engine/data.ts'
import { baseArt, baseKind, baseName, className, type Lang } from '../game/describe.ts'
import type { GameState } from '../game/game.ts'
import { basePrice, buyableBases } from '../game/shop.ts'
import { fmtGold, t } from '../i18n.ts'

const CLASSES = [...new Set(Object.values(BASES).map((b) => b.cls))]

// What the shop shows, kept by the game screen so it survives a trip to another tab (user). The list's scroll is handed
// back when the shop closes, so scrolling itself doesn't re-render anything.
export interface ShopView { cls: string; query: string; ilvl: number; scroll: number }

interface Props {
  lang: Lang
  state: GameState
  view: ShopView
  onView: Dispatch<SetStateAction<ShopView>>
  onBuy: (base: string, ilvl: number) => void
}

export function Shop({ lang, state, view, onView, onBuy }: Props) {
  const { cls, query, ilvl } = view
  const list = useRef<HTMLUListElement>(null)
  // Back where the player left the list, and remember the spot on the way out. A new filter starts from the top.
  const top = useRef(view.scroll)
  useLayoutEffect(() => {
    const el = list.current
    if (el) el.scrollTop = top.current
    return () => onView((v) => ({ ...v, scroll: top.current }))
  }, [onView])
  const set = (patch: Partial<ShopView>) => {
    top.current = 0
    if (list.current) list.current.scrollTop = 0
    onView({ ...view, ...patch })
  }

  const rows = useMemo(() => buyableBases()
    .filter((id) => (cls === '' || BASES[id].cls === cls) && baseName(id, lang).toLowerCase().includes(query.toLowerCase()))
    .map((id) => ({ id, price: basePrice(id, ilvl, state.day) }))
    .sort((a, b) => BASES[b.id].lvl - BASES[a.id].lvl), [cls, query, ilvl, lang, state.day])

  return (
    <section className="panel shop">
      <h2>{t(lang, 'shop')}</h2>

      <div className="shop-filters">
        <select value={cls} onChange={(e) => set({ cls: e.target.value })}>
          <option value="">{t(lang, 'allClasses')}</option>
          {CLASSES.map((c) => <option key={c} value={c}>{className(c, lang)}</option>)}
        </select>
        <input value={query} placeholder={t(lang, 'baseSearch')} onChange={(e) => set({ query: e.target.value })} />
        <label>
          {t(lang, 'itemLevel')}{' '}
          <input type="number" min={1} max={86} value={ilvl}
            onChange={(e) => onView({ ...view, ilvl: Math.min(86, Math.max(1, Math.round(+e.target.value))) })} />
        </label>
      </div>

      <ul className="bases" ref={list} onScroll={(e) => { top.current = e.currentTarget.scrollTop }}>
        {rows.map(({ id, price }) => (
          <li key={id}>
            <img src={`${import.meta.env.BASE_URL}${baseArt(id)}`} alt="" loading="lazy" />
            <span className="base-name">
              <span className="base-title">
                {baseName(id, lang)}
                <button disabled={price > state.gold} onClick={() => onBuy(id, ilvl)}>{t(lang, 'buy')} {fmtGold(price)}</button>
              </span>
              <small>{className(BASES[id].cls, lang)} · {baseKind(id, lang) || '—'} · lv {BASES[id].lvl}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
