// The most popular builds today (league phase, patches and drift included), above the tabs; folds away (remembered).
import { useMemo } from 'react'
import type { Lang } from '../game/describe.ts'
import { BUILDS, popularity, trend, type Meta } from '../game/meta.ts'
import { t } from '../i18n.ts'

const TOP = 5

interface Props { lang: Lang; meta: Meta; day: number; open: boolean; onToggle: (open: boolean) => void }

export function Popular({ lang, meta, day, open, onToggle }: Props) {
  const top = useMemo(() => [...BUILDS].sort((a, b) => popularity(meta, b.id, day) - popularity(meta, a.id, day)).slice(0, TOP), [meta, day])
  return (
    <details className="popular" open={open} onToggle={(e) => { if (e.currentTarget.open !== open) onToggle(e.currentTarget.open) }}>
      <summary>{t(lang, 'popularTop', TOP)}</summary>
      <ol>
        {top.map((b) => {
          const tr = trend(meta, b.id, day)
          return <li key={b.id}>{b.name[lang]}{tr && <span className={`trend ${tr}`}> {t(lang, tr === 'rising' ? 'trendRising' : 'trendFalling')}</span>}</li>
        })}
      </ol>
    </details>
  )
}
