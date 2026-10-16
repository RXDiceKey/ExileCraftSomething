import { useMemo, useState, type ReactNode } from 'react'
import { sfx } from '../audio.ts'
import { benchOptions, canEssence, canFossils, CRAFTING, MATRON, matronOptions, removable, resonatorFor, swapsCrafted } from '../engine/crafting.ts'
import { CURRENCIES, type CurrencyId } from '../engine/currency.ts'
import { BASES, MODS } from '../engine/data.ts'
import { BEAST_RECIPES, canImprint, canRestore, IMPRINT, IMPRINT_BEAST, IMPRINT_RECIPE } from '../engine/beasts.ts'
import { canRecombine } from '../engine/recombinator.ts'
import { HARVEST, LIFEFORCE, type Lifeforce } from '../engine/harvest.ts'
import { canReveal, canUnveil, isVeiled } from '../engine/veiled.ts'
import { canEldritchImplicit, conflictChance, dominance, eldritchTier, EMBERS, ICHORS } from '../engine/eldritch.ts'
import { AWAKENER, canAwaken, canDominance, canInfluenceExalt, DOMINANCE, INFLUENCE_EXALTS, isInfluenced } from '../engine/influence.ts'
import type { Item } from '../engine/item.ts'
import { bestiaryText, gameText, harvestText, influenceName, itemName, modLines, rangeText, statLabel, type Lang } from '../game/describe.ts'
import {
  beastCost, benchCost, ELDRITCH_ORBS, fossilCost, harvestCost, recombineCost, VEILED_ORBS, type SpamOptions, type SpamReport, type StashItem,
} from '../game/game.ts'
import { CURRENCY_EN, currencyPrice, iconOf, MIRROR, nameOf, priceOf } from '../game/shop.ts'
import { fmtGold, t } from '../i18n.ts'
import { Tooltip } from './Tooltip.tsx'

const ORBS: CurrencyId[] = [
  'transmutation', 'alteration', 'augmentation', 'regal', 'alchemy', 'binding', 'chaos', 'exalted',
  'annulment', 'divine', 'blessed', 'scouring', 'vaal', 'fracturing', 'whetstone', 'scrap',
]
const ESSENCES = Object.keys(CRAFTING.essences)

// An item's options, one per line (recombinator / Awakener lists); `keep` marks the ones that can carry over.
function ModList({ item, lang, keep }: { item: Item; lang: Lang; keep?: (id: string) => boolean }) {
  return (
    <ul className="mod-list">
      {modLines(item, lang).filter((l) => l.kind !== 'implicit').map((l, k) => (
        <li key={k} className={keep?.(l.id) ? 'keep' : undefined}>{l.text.join(' / ')}</li>
      ))}
    </ul>
  )
}
const FOSSILS = Object.keys(CRAFTING.fossils)

type Tab = 'orbs' | 'bench' | 'essence' | 'fossil' | 'influence' | 'eldritch' | 'harvest' | 'beast' | 'veiled' | 'recombine'

interface Props {
  lang: Lang
  entry: StashItem | undefined
  stash: StashItem[]
  gold: number
  day: number // lifeforce prices move with the day
  canSpam: boolean // a search is typed in
  lit: boolean | null // does the item match the search (null: no search)
  onCurrency: (c: CurrencyId) => void
  onBench: (index: number) => void
  onRemoveCrafted: () => void
  onMatron: () => void
  onEssence: (name: string) => void
  onFossils: (names: string[]) => void
  onMirror: () => void
  onInfluenceExalt: (name: string) => void
  onDominance: () => void
  onAwaken: (donorUid: number) => void
  onEldritchImplicit: (name: string) => void
  onEldritchOrb: (name: string) => void
  onHarvest: (id: string) => void
  onBeast: (id: string) => void
  onImprint: () => void
  onRestore: () => void
  onVeiledOrb: (name: string) => void
  onRecombine: (otherUid: number) => void
  onReveal: () => void
  onUnveil: (choice: string) => void
  onSpam: (o: SpamOptions) => SpamReport | null
  onFaustus: () => void
  header?: ReactNode // day / gold and the goal, pinned with the item (user)
}

const icon = (en: string) => `${import.meta.env.BASE_URL}${iconOf(en)}`

export function Bench(p: Props) {
  const { lang, entry, gold } = p
  const [tab, setTab] = useState<Tab>('orbs')
  const [fossils, setFossils] = useState<string[]>([])
  const [opts, setOpts] = useState<SpamOptions>({ augPrefix: false, augSuffix: false, maxTries: 500, goldCap: 20_000 })
  const [report, setReport] = useState<SpamReport | null>(null)
  const item = entry?.item
  // Bench crafts grouped by option family (user), tiers together, in the bench's order.
  const bench = useMemo(() => {
    const groups = new Map<string, number[]>()
    for (const i of item ? benchOptions(item) : []) {
      const type = MODS[CRAFTING.bench[i].mod].type
      groups.set(type, [...(groups.get(type) ?? []), i])
    }
    return [...groups.values()]
  }, [item])
  if (!item) return <section className="panel bench"><div className="bench-item">{p.header}</div><p className="hint">{t(lang, 'selectItem')}</p></section>

  const tabButton = (k: Tab, label: string) => (
    <button className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>{label}</button>
  )
  const cost = fossils.length ? fossilCost(item, fossils) : 0
  // One currency button: icon, price, greyed out when it can't be used or isn't affordable.
  const orb = (en: string, can: boolean, onUse: () => void) => (
    <button key={en} className="currency" disabled={!can || priceOf(en) > gold} data-tip={`${nameOf(en, lang)} — ${fmtGold(priceOf(en))}`}
      onClick={() => { sfx('currencyApply'); onUse() }}>
      <img src={icon(en)} alt={nameOf(en, lang)} />
      <small>{fmtGold(priceOf(en))}</small>
    </button>
  )
  const donors = p.stash.filter((d) => d.uid !== entry!.uid && canAwaken(d.item, item))
  const pane = (
    <div className="bench-item">
      {p.header}
      {item.explicits.some(isVeiled) && <p className="boom">{t(lang, 'veiledBlocked')}</p>}
      <Tooltip item={item} lang={lang} lit={p.lit} />
      <button className="primary" onClick={p.onFaustus}>{t(lang, 'takeToFaustus')}</button>
    </div>
  )
  // Nothing on the bench touches a corrupted or mirrored item (user): say so instead of a wall of greyed-out buttons.
  if (item.corrupted || item.mirrored) {
    return (
      <section className="panel bench">
        <h2>{t(lang, 'bench')}</h2>
        {pane}
        <p className="hint">{t(lang, item.corrupted ? 'benchCorrupted' : 'benchMirrored')}</p>
      </section>
    )
  }

  return (
    <section className="panel bench">
      <h2>{t(lang, 'bench')}</h2>
      <nav className="tabs sub">
        {tabButton('orbs', t(lang, 'tabOrbs'))}
        {tabButton('bench', t(lang, 'tabBench'))}
        {tabButton('essence', t(lang, 'tabEssence'))}
        {tabButton('fossil', t(lang, 'tabFossil'))}
        {tabButton('influence', t(lang, 'tabInfluence'))}
        {tabButton('eldritch', t(lang, 'tabEldritch'))}
        {tabButton('harvest', t(lang, 'tabHarvest'))}
        {tabButton('beast', t(lang, 'tabBeast'))}
        {tabButton('veiled', t(lang, 'tabVeiled'))}
        {tabButton('recombine', t(lang, 'tabRecombine'))}
      </nav>

      {tab === 'orbs' && (
        <>
          <div className="currencies">
            {ORBS.map((c) => {
              const price = currencyPrice(c)
              return (
                <button key={c} className="currency" disabled={!CURRENCIES[c].can(item) || price > gold}
                  data-tip={`${nameOf(CURRENCY_EN[c], lang)} — ${fmtGold(price)}`}
                  onClick={() => { sfx('currencyApply'); p.onCurrency(c) }}>
                  <img src={icon(CURRENCY_EN[c])} alt={nameOf(CURRENCY_EN[c], lang)} />
                  <small>{fmtGold(price)}</small>
                </button>
              )
            })}
            <button className="currency" disabled={!!item.mirrored || !!item.corrupted || priceOf(MIRROR) > gold}
              data-tip={`${nameOf(MIRROR, lang)} — ${fmtGold(priceOf(MIRROR))}`} onClick={() => { sfx('currencyApply'); p.onMirror() }}>
              <img src={icon(MIRROR)} alt={nameOf(MIRROR, lang)} />
              <small>{fmtGold(priceOf(MIRROR))}</small>
            </button>
          </div>

          <fieldset className="spam">
            <legend>{t(lang, 'spam')}</legend>
            <label><input type="checkbox" checked={opts.augPrefix} onChange={(e) => setOpts({ ...opts, augPrefix: e.target.checked })} /> {t(lang, 'augPrefix')}</label>
            <label><input type="checkbox" checked={opts.augSuffix} onChange={(e) => setOpts({ ...opts, augSuffix: e.target.checked })} /> {t(lang, 'augSuffix')}</label>
            <label>{t(lang, 'maxTries')} <input type="number" min={1} value={opts.maxTries} onChange={(e) => setOpts({ ...opts, maxTries: Math.max(1, +e.target.value) })} /></label>
            <label>{t(lang, 'goldCap')} <input type="number" min={0} step={1000} value={opts.goldCap} onChange={(e) => setOpts({ ...opts, goldCap: Math.max(0, +e.target.value) })} /></label>
            <button disabled={!p.canSpam || item.rarity !== 'magic'}
              data-tip={!p.canSpam ? t(lang, 'spamNeedSearch') : item.rarity !== 'magic' ? t(lang, 'spamNeedMagic') : ''}
              onClick={() => { sfx('button'); setReport(p.onSpam(opts)) }}>
              {t(lang, 'start')}
            </button>
            {report && <p>{t(lang, 'spamResult', report.alts, report.augs, fmtGold(report.spent), t(lang, `stop_${report.stop}`))}</p>}
          </fieldset>
        </>
      )}

      {tab === 'bench' && (
        <>
          {removable(item) && (
            <button disabled={currencyPrice('scouring') > gold} onClick={() => { sfx('button'); p.onRemoveCrafted() }}>
              {t(lang, 'removeCrafted')} — {fmtGold(currencyPrice('scouring'))}
            </button>
          )}
          {bench.length === 0 && <p className="hint">{t(lang, 'benchNone')}</p>}
          {bench.length > 0 && swapsCrafted(item) && <p className="hint">{t(lang, 'benchSwaps', fmtGold(currencyPrice('scouring')))}</p>}
          <div className="bench-groups">
            {bench.map((ids) => {
              const rows = (
                <ul className="craft-list">
                  {ids.map((i) => {
                    const cost = benchCost(item, i)
                    return (
                      <li key={i}>
                        <span>{rangeText(item, CRAFTING.bench[i].mod, lang).join(' / ')}</span>
                        <button disabled={cost > gold} onClick={() => { sfx('currencyApply'); p.onBench(i) }}>{fmtGold(cost)}</button>
                      </li>
                    )
                  })}
                </ul>
              )
              if (ids.length === 1) return <div key={ids[0]}>{rows}</div>
              const name = MODS[CRAFTING.bench[ids[0]].mod].stats.map(([s]) => statLabel(s, lang)?.[1] ?? s).join(' / ')
              return <details key={ids[0]}><summary>{name} <span className="hint">({ids.length})</span></summary>{rows}</details>
            })}
          </div>
        </>
      )}

      {/* A list, not icons with hover tips (user: phones have no hover): name, guaranteed option and price on each row. */}
      {tab === 'essence' && (
        <ul className="craft-list pick-list">
          {ESSENCES.filter((n) => canEssence(item, n)).map((n) => (
            <li key={n}>
              <button disabled={priceOf(n) > gold} onClick={() => { sfx('currencyApply'); p.onEssence(n) }}>
                <img src={icon(n)} alt="" />
                <span><b>{nameOf(n, lang)}</b><small>{rangeText(item, CRAFTING.essences[n].mods[BASES[item.base].cls], lang).join(' / ')}</small></span>
                <span className="gold">{fmtGold(priceOf(n))}</span>
              </button>
            </li>
          ))}
          {!ESSENCES.some((n) => canEssence(item, n)) && <li className="hint">{t(lang, 'essenceNone')}</li>}
        </ul>
      )}

      {tab === 'influence' && (
        <>
          <div className="currencies">
            {Object.entries(INFLUENCE_EXALTS).map(([en, inf]) => orb(en, canInfluenceExalt(item, inf), () => p.onInfluenceExalt(en)))}
            {orb(DOMINANCE, canDominance(item), p.onDominance)}
          </div>
          <h3><img className="inline-icon" src={icon(AWAKENER)} alt="" /> {nameOf(AWAKENER, lang)} — {fmtGold(priceOf(AWAKENER))}</h3>
          {donors.length === 0 ? <p className="hint">{t(lang, 'awakenNone')}</p> : (
            <>
              {/* The selected item is the base; one highlighted (influence) option from each item stays. */}
              <div className="awaken-base">
                <b>{t(lang, 'awakenBase')}: {itemName(item, lang)}</b> · {item.influences.map((i) => influenceName(i, lang)).join(', ')}
                <ModList item={item} lang={lang} keep={isInfluenced} />
                <span className="hint">{t(lang, 'awakenKeep')}</span>
              </div>
              <ul className="craft-list partner-list">
                {donors.map((d) => (
                  <li key={d.uid}>
                    <div>
                      <span>{itemName(d.item, lang)} · {d.item.influences.map((i) => influenceName(i, lang)).join(', ')} · ilvl {d.item.ilvl}</span>
                      <ModList item={d.item} lang={lang} keep={isInfluenced} />
                    </div>
                    <button disabled={priceOf(AWAKENER) > gold} onClick={() => { sfx('currencyApply'); p.onAwaken(d.uid) }}>{t(lang, 'awakenUse')}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {tab === 'eldritch' && (() => {
        const x = eldritchTier(item, 'exarch')
        const y = eldritchTier(item, 'eater')
        const tierName = (n: number) => (n ? gameText(lang, `eldritchTier${n}`) : '—')
        const dom = dominance(item)
        return (
          <>
            <p>
              {gameText(lang, 'exarchItem')}: {tierName(x)} · {gameText(lang, 'eaterItem')}: {tierName(y)} · {t(lang, 'dominant')}: {dom ? gameText(lang, `${dom}Item`) + (dom === 'exarch' ? ` (${t(lang, 'prefix')})` : ` (${t(lang, 'suffix')})`) : t(lang, 'noDominance')}
              {x > 0 && y > 0 && ` · ${t(lang, 'conflictOdds', Math.round(conflictChance(item) * 100))}`}
            </p>
            <div className="currencies">
              {Object.entries(EMBERS).map(([en, tier]) => orb(en, canEldritchImplicit(item, 'exarch', tier), () => p.onEldritchImplicit(en)))}
            </div>
            <div className="currencies">
              {Object.entries(ICHORS).map(([en, tier]) => orb(en, canEldritchImplicit(item, 'eater', tier), () => p.onEldritchImplicit(en)))}
            </div>
            <div className="currencies">
              {Object.entries(ELDRITCH_ORBS).map(([en, o]) => orb(en, o.can(item), () => p.onEldritchOrb(en)))}
            </div>
          </>
        )
      })()}

      {tab === 'harvest' && (() => {
        const usable = HARVEST.filter((c) => c.can(item))
        return (
          <>
            {usable.length === 0 && <p className="hint">{t(lang, 'harvestNone')}</p>}
            <ul className="craft-list">
              {usable.map((c) => {
                const price = harvestCost(c.cost, p.day)
                return (
                  <li key={c.id}>
                    <span>{harvestText(c.id, lang)}</span>
                    <span className="lifeforce">
                      {Object.entries(c.cost).map(([k, n]) => {
                        const en = LIFEFORCE[k as Lifeforce]
                        return iconOf(en).endsWith('/')
                          ? <span key={k}>{nameOf(en, lang)} {n}</span>
                          : <span key={k} data-tip={nameOf(en, lang)}><img className="inline-icon" src={icon(en)} alt={nameOf(en, lang)} />{n}</span>
                      })}
                    </span>
                    <button disabled={price > gold} onClick={() => { sfx('currencyApply'); p.onHarvest(c.id) }}>{fmtGold(price)}</button>
                  </li>
                )
              })}
            </ul>
          </>
        )
      })()}

      {tab === 'beast' && (
        <>
          <ul className="craft-list">
            <li>
              <span>{nameOf(IMPRINT, lang)}: {bestiaryText(IMPRINT_RECIPE, lang)} — {nameOf(IMPRINT_BEAST, lang)}</span>
              <button disabled={!canImprint(item) || priceOf(IMPRINT_BEAST) > gold}
                onClick={() => { sfx('currencyApply'); p.onImprint() }}>{fmtGold(priceOf(IMPRINT_BEAST))}</button>
            </li>
            {item.imprint && (
              <li>
                <span>{t(lang, 'restoreImprint')}</span>
                <button className="primary" disabled={!canRestore(item)} onClick={() => { sfx('currencyApply'); p.onRestore() }}>{t(lang, 'restore')}</button>
              </li>
            )}
            <li>
              <span>{bestiaryText('EinharMasterCraftMemoryLine1', lang)} — {nameOf(MATRON, lang)}</span>
              <button disabled={!matronOptions(item).length || priceOf(MATRON) > gold}
                onClick={() => { sfx('currencyApply'); p.onMatron() }}>{fmtGold(priceOf(MATRON))}</button>
            </li>
            {BEAST_RECIPES.filter((r) => r.can(item)).map((r) => (
              <li key={r.id}>
                <span>{bestiaryText(r.id, lang)} — {r.beasts.map((b) => nameOf(b, lang)).join(' + ')}</span>
                <button disabled={beastCost(r.beasts) > gold} onClick={() => { sfx('currencyApply'); p.onBeast(r.id) }}>{fmtGold(beastCost(r.beasts))}</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'veiled' && (() => {
        const choices = item.explicits.find((m) => m.unveil)?.unveil ?? []
        return (
          <>
            <div className="currencies">
              {Object.entries(VEILED_ORBS).map(([en, o]) => orb(en, o.can(item), () => p.onVeiledOrb(en)))}
            </div>
            {canReveal(item) && (
              <button className="primary" onClick={() => { sfx('currencyApply'); p.onReveal() }}>{gameText(lang, 'unveil')}</button>
            )}
            {choices.length > 0 && (
              <ul className="craft-list">
                {choices.map((id) => (
                  <li key={id}>
                    <span>{rangeText(item, id, lang).join(' / ')}</span>
                    <button disabled={!canUnveil(item, id)} onClick={() => { sfx('currencyApply'); p.onUnveil(id) }}>{t(lang, 'choose')}</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      })()}

      {tab === 'recombine' && (() => {
        const partners = p.stash.filter((d) => d.uid !== entry!.uid && canRecombine(item, d.item))
        return (
          <>
            {partners.length === 0 ? <p className="hint">{t(lang, 'recombineNone')}</p> : (
              <ul className="craft-list partner-list">
                {partners.map((d) => {
                  const price = recombineCost(item, d.item)
                  return (
                    <li key={d.uid}>
                      <div>
                        <span>{itemName(d.item, lang)} · ilvl {d.item.ilvl}</span>
                        <ModList item={d.item} lang={lang} />
                      </div>
                      <button disabled={price > gold} onClick={() => { sfx('currencyApply'); p.onRecombine(d.uid) }}>{t(lang, 'recombine')} {fmtGold(price)}</button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )
      })()}

      {tab === 'fossil' && (
        <>
          <div className="currencies">
            {FOSSILS.map((n) => {
              const on = fossils.includes(n)
              return (
                <button key={n} className={`currency ${on ? 'picked' : ''}`} disabled={!on && fossils.length >= 4}
                  data-tip={`${nameOf(n, lang)} — ${fmtGold(priceOf(n))}`}
                  onClick={() => setFossils(on ? fossils.filter((x) => x !== n) : [...fossils, n])}>
                  <img src={icon(n)} alt={nameOf(n, lang)} />
                  <small>{fmtGold(priceOf(n))}</small>
                </button>
              )
            })}
          </div>
          {fossils.length > 0 && (
            <p>
              {fossils.map((n) => nameOf(n, lang)).join(' + ')} · {nameOf(resonatorFor(fossils.length, item), lang)} — {fmtGold(cost)}{' '}
              <button className="primary" disabled={!canFossils(item, fossils) || cost > gold}
                onClick={() => { sfx('currencyApply'); p.onFossils(fossils) }}>{t(lang, 'applyFossils')}</button>
            </p>
          )}
        </>
      )}

      {pane}
    </section>
  )
}
