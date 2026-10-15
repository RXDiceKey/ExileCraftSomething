import { defences, type Item } from '../engine/item.ts'
import { baseArt, baseKind, defenceName, eldritchItemLines, eldritchLabel, gameText, influenceName, itemName, modLines, type Lang } from '../game/describe.ts'
import { t, tierText } from '../i18n.ts'

// lit: the search's bright/dim look (true matches, false doesn't, null/undefined no search).
export function Tooltip({ item, lang, lit }: { item: Item; lang: Lang; lit?: boolean | null }) {
  const lines = modLines(item, lang)
  const implicits = lines.filter((l) => l.kind === 'implicit')
  const explicits = lines.filter((l) => l.kind !== 'implicit')
  return (
    <div className={`tooltip ${item.rarity}${lit === true ? ' lit' : lit === false ? ' unlit' : ''}`}>
      <div className="tt-head">{itemName(item, lang)}</div>
      <div className="tt-body">
        <img className="tt-art" src={`${import.meta.env.BASE_URL}${baseArt(item.base)}`} alt="" />
        <div className="tt-meta">{baseKind(item.base, lang)}</div>
        <div className="tt-meta">{t(lang, 'itemLevel')}: {item.ilvl}</div>
        {!!item.quality && <div className="tt-meta">{t(lang, 'quality')}: +{item.quality}%</div>}
        {Object.entries(defences(item)).map(([d, v]) => <div key={d} className="tt-meta">{defenceName(d, lang)}: {v}</div>)}
        {item.imprint && <div className="tt-meta">{t(lang, 'imprinted')}</div>}
        {item.influences.map((i) => (
          <div key={i} className="tt-influence">{influenceName(i, lang)}</div>
        ))}
        {eldritchItemLines(item, lang).map((line) => <div key={line} className="tt-influence">{line}</div>)}
        {implicits.length > 0 && <hr />}
        {implicits.map((l) => (
          <div key={l.id} className="mod">
            {eldritchLabel(l.id, lang) && <div className="mod-tag">{eldritchLabel(l.id, lang)}</div>}
            {l.text.map((line, k) => <div key={k} className="mod-line">{line}</div>)}
          </div>
        ))}
        {explicits.length > 0 && <hr />}
        {explicits.map((l) => (
          <div key={l.id} className="mod">
            <div className="mod-tag">
              {t(lang, l.kind === 'prefix' ? 'prefix' : 'suffix')} · {tierText(lang, l.tier ?? 1)} · {l.name}
              {l.crafted && ` · ${t(lang, 'crafted')}`}{l.fractured && ` · ${t(lang, 'fractured')}`}{l.drop && ` · ${gameText(lang, l.drop)}`}
            </div>
            {l.text.map((line, k) => <div key={k} className="mod-line">{line}</div>)}
          </div>
        ))}
        {item.corrupted && <div className="tt-corrupted">{t(lang, 'corrupted')}</div>}
        {item.mirrored && <div className="tt-corrupted">{t(lang, 'mirrored')}</div>}
      </div>
    </div>
  )
}
