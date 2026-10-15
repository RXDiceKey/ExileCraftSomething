import { useEffect, useMemo, useRef, useState } from 'react'
import { FAUSTUS_INTRO, faustusFarewell, faustusGreeting, faustusIntro, sfx } from '../audio.ts'
import type { CurrencyId } from '../engine/currency.ts'
import { searchText, type Lang } from '../game/describe.ts'
import {
  ACTIONS_PER_DAY, buyBase, closeDay, ensureMeta, hunt, LAST_DAY, sell, spamAlteration, useBench, useCurrency, useEssence,
  useAwaken, useBeast, useDominance, useEldritchImplicit, useEldritchOrb, useHarvest, useRecombine, useImprint, useRestore, useReveal, useUnveil, useVeiledOrb, useFossils, useInfluenceExalt, useMatron, useMirror, useRemoveCrafted,
  type GameState, type Result, type SpamOptions,
} from '../game/game.ts'
import { boom, buildName, weekday } from '../game/meta.ts'
import { compileSearch } from '../game/search.ts'
import { fmtGold, t } from '../i18n.ts'
import { exportFile, importFile, type Settings } from '../save.ts'
import { Bench } from './Bench.tsx'
import { Faustus } from './Faustus.tsx'
import { Shop } from './Shop.tsx'
import { Stash } from './Stash.tsx'

interface Props {
  lang: Lang
  state: GameState
  setState: (s: GameState) => void
  settings: Settings
  setSettings: (s: Settings) => void
  onMenu: () => void
}

type View = 'bench' | 'shop' | 'faustus'

const boomPct = (day: number) => Math.round((boom(day) - 1) * 100)

export function Game({ lang, state, setState, settings, setSettings, onMenu }: Props) {
  const [view, setView] = useState<View>(state.stash.length ? 'bench' : 'shop')
  const [selected, setSelected] = useState<number | null>(state.stash[0]?.uid ?? null)
  const [notice, setNotice] = useState<string | null>(null)
  const [subtitle, setSubtitle] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const entry = state.stash.find((x) => x.uid === selected)
  const match = useMemo(() => compileSearch(settings.search), [settings.search])
  const actionsLeft = ACTIONS_PER_DAY - state.used

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(id)
  }, [notice])

  const errorText = (error: string) => t(lang, `err_${error as 'noGold'}`)
  function run(r: Result) {
    if (r.ok) setState(r.state)
    else setNotice(errorText(r.error))
    return r.ok
  }

  const onBuy = (base: string, ilvl: number) => {
    sfx('button')
    const uid = state.nextUid
    if (run(buyBase(state, base, ilvl))) { setSelected(uid); setView('bench') }
  }
  const onCurrency = (c: CurrencyId) => selected !== null && run(useCurrency(state, selected, c))
  const onBench = (i: number) => selected !== null && run(useBench(state, selected, i))
  const onRemoveCrafted = () => selected !== null && run(useRemoveCrafted(state, selected))
  const onEssence = (n: string) => selected !== null && run(useEssence(state, selected, n))
  const onFossils = (ns: string[]) => selected !== null && run(useFossils(state, selected, ns))
  const onMirror = () => selected !== null && run(useMirror(state, selected))
  const onMatron = () => selected !== null && run(useMatron(state, selected))
  const onInfluenceExalt = (n: string) => selected !== null && run(useInfluenceExalt(state, selected, n))
  const onDominance = () => selected !== null && run(useDominance(state, selected))
  const onAwaken = (donor: number) => selected !== null && run(useAwaken(state, donor, selected))
  const onEldritchImplicit = (n: string) => selected !== null && run(useEldritchImplicit(state, selected, n))
  const onEldritchOrb = (n: string) => selected !== null && run(useEldritchOrb(state, selected, n))
  const onHarvest = (id: string) => selected !== null && run(useHarvest(state, selected, id))
  const onBeast = (id: string) => selected !== null && run(useBeast(state, selected, id))
  const onImprint = () => selected !== null && run(useImprint(state, selected))
  const onRestore = () => selected !== null && run(useRestore(state, selected))
  const onVeiledOrb = (n: string) => selected !== null && run(useVeiledOrb(state, selected, n))
  const onRecombine = (other: number) => {
    if (selected === null) return
    const uid = state.nextUid
    if (run(useRecombine(state, selected, other))) setSelected(uid)
  }
  const onReveal = () => selected !== null && run(useReveal(state, selected))
  const onUnveil = (id: string) => selected !== null && run(useUnveil(state, selected, id))
  const onSpam = (o: SpamOptions) => {
    if (!match || selected === null) return null
    const r = spamAlteration(state, selected, (item) => match(searchText(item, lang)), o)
    setState(r.state)
    return r
  }

  const openFaustus = () => {
    setView('faustus')
    if (!settings.seenIntro) {
      faustusIntro()
      setSubtitle(FAUSTUS_INTRO[lang])
      setSettings({ ...settings, seenIntro: true })
    } else {
      faustusGreeting()
      setSubtitle(null)
    }
  }
  const onSell = () => {
    if (selected === null) return
    const r = sell(state, selected)
    if (!r.ok) return setNotice(errorText(r.error))
    setState(r.state.state)
    setNotice(t(lang, 'sold', fmtGold(r.state.price)))
    faustusFarewell()
    setSelected(r.state.state.stash[0]?.uid ?? null)
  }
  const onHunt = () => {
    sfx('button')
    const r = hunt(state)
    if (!r.ok) return setNotice(errorText(r.error))
    setState(r.state.state)
    setNotice(t(lang, 'huntResult', fmtGold(r.state.reward)))
  }
  const onCloseDay = () => {
    sfx('button')
    if (state.day >= LAST_DAY && !confirm(t(lang, 'confirmLastDay'))) return
    const next = closeDay(state)
    setState(next)
    const fresh = next.meta.notes.slice(state.meta.notes.length)
    const lines: string[] = []
    if (fresh.length) {
      lines.push(`${t(lang, 'patchNotes')}: ` + fresh.map((n) => `${buildName(n.build, lang)} ${t(lang, n.factor > 1 ? 'patchBuff' : 'patchNerf')}`).join(', '))
    }
    if (!next.finished && boom(next.day) > 1 && boom(state.day) === 1) lines.push(t(lang, 'boomStart', boomPct(next.day)))
    if (!next.finished && boom(next.day) === 1 && boom(state.day) > 1) lines.push(t(lang, 'boomEnd'))
    if (lines.length) setNotice(lines.join(' / '))
  }

  const tab = (v: View, label: string) => (
    <button className={view === v ? 'tab active' : 'tab'} onClick={() => (v === 'faustus' ? openFaustus() : setView(v))}>{label}</button>
  )

  return (
    <div className="game">
      <header className="topbar">
        <strong>{t(lang, 'day', state.day, LAST_DAY)} · {t(lang, 'weekdays').split(',')[weekday(state.day)]}</strong>
        {boom(state.day) > 1 && <span className="boom">{t(lang, 'boomBadge', boomPct(state.day))}</span>}
        <span>{t(lang, 'gold')}: <b className="gold">{fmtGold(state.gold)}</b></span>
        {state.pending > 0 && <span>{t(lang, 'pending')}: {fmtGold(state.pending)}</span>}
        <span>{t(lang, 'actionsLeft', actionsLeft, ACTIONS_PER_DAY)}</span>
        <button disabled={actionsLeft <= 0} title={t(lang, 'huntHint')} onClick={onHunt}>{t(lang, 'hunt')}</button>
        <button className="primary" onClick={onCloseDay}>{t(lang, state.day >= LAST_DAY ? 'closeLastDay' : 'closeDay')}</button>
        <div className="menu-wrap">
          <button onClick={() => setMenuOpen(!menuOpen)}>{t(lang, 'menu')}</button>
          {menuOpen && (
            <div className="dropdown">
              <button onClick={() => exportFile(state)}>{t(lang, 'exportSave')}</button>
              <button onClick={() => fileInput.current?.click()}>{t(lang, 'importSave')}</button>
              <label>{t(lang, 'volume')} <input type="range" min={0} max={1} step={0.05} value={settings.volume}
                onChange={(e) => setSettings({ ...settings, volume: +e.target.value })} /></label>
              <label><input type="checkbox" checked={settings.muted} onChange={(e) => setSettings({ ...settings, muted: e.target.checked })} /> {t(lang, 'mute')}</label>
              <button onClick={onMenu}>{t(lang, 'toStartMenu')}</button>
            </div>
          )}
          <input ref={fileInput} type="file" accept="application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const s = await importFile(f)
            if (s) setState(ensureMeta(s))
            else setNotice(t(lang, 'importFailed'))
            e.target.value = ''
          }} />
        </div>
      </header>
      {notice && <div className="notice">{notice}</div>}

      <div className="layout">
        <Stash
          lang={lang}
          stash={state.stash}
          selected={selected}
          onSelect={(uid) => { sfx('itemPickup'); setSelected(uid); if (view === 'shop') setView('bench') }}
          search={settings.search}
          onSearch={(q) => setSettings({ ...settings, search: q })}
        />
        <div className="main">
          <nav className="tabs">
            {tab('bench', t(lang, 'bench'))}
            {tab('shop', t(lang, 'shop'))}
            {tab('faustus', t(lang, 'faustus'))}
          </nav>
          {view === 'bench' && (
            <Bench lang={lang} entry={entry} gold={state.gold} canSpam={!!match}
              onCurrency={onCurrency} onBench={onBench} onRemoveCrafted={onRemoveCrafted} onMatron={onMatron} onEssence={onEssence}
              onFossils={onFossils} onMirror={onMirror} onSpam={onSpam} onFaustus={openFaustus}
              stash={state.stash} onInfluenceExalt={onInfluenceExalt} onDominance={onDominance} onAwaken={onAwaken}
              onEldritchImplicit={onEldritchImplicit} onEldritchOrb={onEldritchOrb} onHarvest={onHarvest}
              onBeast={onBeast} onImprint={onImprint} onRestore={onRestore}
              onVeiledOrb={onVeiledOrb} onReveal={onReveal} onUnveil={onUnveil} onRecombine={onRecombine} />
          )}
          {view === 'shop' && <Shop lang={lang} state={state} onBuy={onBuy} />}
          {view === 'faustus' && (
            <Faustus lang={lang} entry={entry} day={state.day} meta={state.meta} canSell={actionsLeft > 0} subtitle={subtitle}
              onSell={onSell} onBack={() => setView('bench')} />
          )}
        </div>
      </div>
    </div>
  )
}
