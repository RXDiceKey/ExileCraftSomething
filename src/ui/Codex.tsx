// Build codex: every build the player has sold to (as the paying buyer) across runs, with what it wants slot by slot.
import { className, statLabel, type Lang } from '../game/describe.ts'
import { BUILDS, trend, type Codex as CodexData, type Meta, type Slot } from '../game/meta.ts'
import { fmtGold, t } from '../i18n.ts'

const SLOTS: Slot[] = ['weapon', 'offhand', 'helmet', 'body', 'gloves', 'boots', 'ring', 'amulet', 'belt']
const SLOT_CLASSES: Partial<Record<Slot, string[]>> = {
  offhand: ['Shield', 'Quiver'], helmet: ['Helmet'], body: ['Body Armour'], gloves: ['Gloves'], boots: ['Boots'],
  ring: ['Ring'], amulet: ['Amulet'], belt: ['Belt'],
}
const TOP_WANTS = 6

// Most wanted options first; stats that share a line (added damage min/max) show once.
function wantsText(wants: Record<string, number>, lang: Lang): string[] {
  const best = new Map<number, [string, number]>()
  for (const [sid, w] of Object.entries(wants)) {
    const label = statLabel(sid, lang)
    if (label && (best.get(label[0])?.[1] ?? -1) < w) best.set(label[0], [label[1], w])
  }
  return [...best.values()].sort((a, b) => b[1] - a[1]).slice(0, TOP_WANTS).map(([text]) => text)
}

interface Props { lang: Lang; codex: CodexData; meta?: Meta; onBack?: () => void }

export function Codex({ lang, codex, meta, onBack }: Props) {
  const open = BUILDS.filter((b) => b.id in codex)
  return (
    <section className="panel codex">
      <h2>{t(lang, 'codex')} <span className="hint">{t(lang, 'codexProgress', open.length, BUILDS.length)}</span></h2>
      <p className="hint">{t(lang, 'codexNote')}</p>
      {open.map((b) => {
        const tr = meta && trend(meta, b.id)
        return (
          <details key={b.id}>
            <summary>
              {b.name[lang]} — {t(lang, 'codexBest', fmtGold(codex[b.id]))}
              {tr && <span className={`trend ${tr}`}> {t(lang, tr === 'rising' ? 'trendRising' : 'trendFalling')}</span>}
            </summary>
            <ul className="codex-slots">
              {SLOTS.filter((s) => b.slots[s]).map((s) => {
                const want = b.slots[s]!
                const where = (want.classes ?? SLOT_CLASSES[s])?.map((c) => className(c, lang)).join('·') || t(lang, 'slotWeapon')
                return <li key={s}><b>{where}</b>: {wantsText(want.wants, lang).join(', ')}</li>
              })}
            </ul>
          </details>
        )
      })}
      {open.length < BUILDS.length && <p className="hint">{t(lang, 'codexLocked', BUILDS.length - open.length)}</p>}
      {onBack && <div className="menu"><button onClick={onBack}>{t(lang, 'back')}</button></div>}
    </section>
  )
}
