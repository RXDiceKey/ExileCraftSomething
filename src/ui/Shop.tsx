import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { BASES } from '../engine/data.ts'
import { newItem } from '../engine/item.ts'
import { attrName, baseArt, baseKindKeys, baseName, baseStats, className, gameText, rangeText, type Lang } from '../game/describe.ts'
import { spendable, type GameState } from '../game/game.ts'
import { basePrice, buyableBases, isSpecialBase, isTopBase } from '../game/shop.ts'
import { DROP_SOURCES, dropOptions, SPECIAL_ILVL, unidentifiedPrice, type DropSource } from '../game/specials.ts'
import { fmtGold, t } from '../i18n.ts'

const CLASSES = [...new Set(Object.values(BASES).map((b) => b.cls))]

// What the shop shows, kept by the game screen so it survives a trip to another tab (user). The list's scroll is handed
// back when the shop closes, so scrolling itself doesn't re-render anything.
// kind: plain bases, or unidentified special bases of one drop source (D42); lower: also the lower bases.
// attr: armour by attribute mix (user), '' for all.
export interface ShopView { cls: string; query: string; ilvl: number; scroll: number; kind: '' | DropSource; lower: boolean; attr?: string }
const ARMOUR = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Shield']
const ATTRS = ['str', 'dex', 'int', 'str_dex', 'str_int', 'dex_int']

interface Props {
  lang: Lang
  state: GameState
  view: ShopView
  onView: Dispatch<SetStateAction<ShopView>>
  onBuy: (base: string, ilvl: number) => void
  onBuyUnidentified: (source: DropSource, base: string) => void
}

export function Shop({ lang, state, view, onView, onBuy, onBuyUnidentified }: Props) {
  const { cls, query, ilvl, kind, lower } = view
  // Only armour has an attribute mix to pick; for another class the filter is off.
  const attrOn = cls === '' || ARMOUR.includes(cls)
  const attr = attrOn ? view.attr ?? '' : ''
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
    .filter((id) => (cls === '' || BASES[id].cls === cls) && (lower || isTopBase(id))
      && (!kind || dropOptions(kind, id).length > 0) && baseName(id, lang).toLowerCase().includes(query.toLowerCase())
      && (!attr || (ARMOUR.includes(BASES[id].cls) && baseKindKeys(id).attrs.join('_') === attr)))
    .map((id) => ({ id, price: kind ? unidentifiedPrice(kind, id, state.day) : basePrice(id, ilvl, state.day) }))
    // Ordinary bases first, then the special ones (user); highest level first within each.
    .sort((a, b) => +isSpecialBase(a.id) - +isSpecialBase(b.id) || BASES[b.id].lvl - BASES[a.id].lvl), [cls, query, ilvl, kind, lower, attr, lang, state.day])

  return (
    <section className="panel shop">
      <h2>{t(lang, 'shop')}</h2>

      <div className="shop-filters">
        <select value={kind} onChange={(e) => set({ kind: e.target.value as ShopView['kind'] })}>
          <option value="">{t(lang, 'plainBases')}</option>
          {DROP_SOURCES.map((s) => <option key={s} value={s}>{gameText(lang, s)} · {t(lang, 'unidentified')}</option>)}
        </select>
        <select value={cls} onChange={(e) => set({ cls: e.target.value })}>
          <option value="">{t(lang, 'allClasses')}</option>
          {CLASSES.map((c) => <option key={c} value={c}>{className(c, lang)}</option>)}
        </select>
        {attrOn && (
          <select value={attr} onChange={(e) => set({ attr: e.target.value })}>
            <option value="">{t(lang, 'allAttrs')}</option>
            {ATTRS.map((a) => <option key={a} value={a}>{a.split('_').map((x) => attrName(x, lang)).join('·')}</option>)}
          </select>
        )}
        <input value={query} placeholder={t(lang, 'baseSearch')} onChange={(e) => set({ query: e.target.value })} />
        {kind ? <span>{t(lang, 'itemLevel')} {SPECIAL_ILVL}</span> : (
          <label>
            {t(lang, 'itemLevel')}{' '}
            <input type="number" min={1} max={86} value={ilvl}
              onChange={(e) => onView({ ...view, ilvl: Math.min(86, Math.max(1, Math.round(+e.target.value))) })} />
          </label>
        )}
        <button onClick={() => set({ lower: !lower })}>{t(lang, lower ? 'hideLowerBases' : 'showLowerBases')}</button>
      </div>

      <ul className="bases" ref={list} onScroll={(e) => { top.current = e.currentTarget.scrollTop }}>
        {rows.map(({ id, price }) => (
          <li key={id}>
            <img src={`${import.meta.env.BASE_URL}${baseArt(id)}`} alt="" loading="lazy" />
            <span className="base-name">
              <span className="base-title">
                {baseName(id, lang)}
                <button disabled={price > spendable(state)} onClick={() => (kind ? onBuyUnidentified(kind, id) : onBuy(id, ilvl))}>
                  {t(lang, 'buy')} {fmtGold(price)}
                </button>
              </span>
              <small>{className(BASES[id].cls, lang)} · {baseStats(id, lang) || '—'}</small>
              {kind && <Options lang={lang} source={kind} base={id} />}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// The options an unidentified special base can come with, folded.
function Options({ lang, source, base }: { lang: Lang; source: DropSource; base: string }) {
  const ids = dropOptions(source, base)
  const item = newItem(base, SPECIAL_ILVL, { s: 1 })
  return (
    <details className="drop-options">
      <summary>{t(lang, 'possibleOptions', ids.length)}</summary>
      <ul>{ids.map((id) => <li key={id}>{rangeText(item, id, lang).join(' / ')}</li>)}</ul>
    </details>
  )
}
