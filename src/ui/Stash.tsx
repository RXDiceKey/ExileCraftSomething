import { useMemo } from 'react'
import { baseArt, baseKind, itemName, searchText, type Lang } from '../game/describe.ts'
import type { StashItem } from '../game/game.ts'
import { compileSearch } from '../game/search.ts'
import { t } from '../i18n.ts'

interface Props {
  lang: Lang
  stash: StashItem[]
  selected: number | null
  onSelect: (uid: number) => void
  search: string
  onSearch: (q: string) => void
}

export function Stash({ lang, stash, selected, onSelect, search, onSearch }: Props) {
  const match = useMemo(() => compileSearch(search), [search])
  return (
    <aside className="stash panel">
      <h2>{t(lang, 'stash')}</h2>
      <input
        className="search"
        value={search}
        placeholder={t(lang, 'searchPlaceholder')}
        onChange={(e) => onSearch(e.target.value)}
      />
      {stash.length === 0 && <p className="hint">{t(lang, 'emptyStash')}</p>}
      <ul>
        {stash.map(({ uid, item }) => {
          const lit = !match || match(searchText(item, lang))
          return (
            <li key={uid}>
              <button
                className={`stash-item ${item.rarity} ${lit ? '' : 'dim'} ${uid === selected ? 'selected' : ''}`}
                onClick={() => onSelect(uid)}
              >
                <img src={`${import.meta.env.BASE_URL}${baseArt(item.base)}`} alt="" loading="lazy" />
                <span className="stash-name">
                  <span>{itemName(item, lang)}</span>
                  <small>{baseKind(item.base, lang)}</small>
                </span>
                <small>ilvl {item.ilvl}</small>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
