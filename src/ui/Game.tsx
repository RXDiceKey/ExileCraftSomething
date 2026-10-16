import { useEffect, useMemo, useRef, useState } from 'react'
import { faustusFarewell, faustusGreeting, sfx } from '../audio.ts'
import type { CurrencyId } from '../engine/currency.ts'
import { BASES } from '../engine/data.ts'
import { searchText, type Lang } from '../game/describe.ts'
import {
  ACTIONS_PER_DAY, buyBase, buyUnidentified, closeDay, DEBT_DAYS, deliver, dismissCommission, hunt, spendable, upgradeSave, LAST_DAY, sell, spamAlteration, doBench, doCurrency, doEssence,
  doAwaken, doBeast, doDominance, doEldritchImplicit, doEldritchOrb, doHarvest, doRecombine, doImprint, doRestore, doReveal, doUnveil, doVeiledOrb, doFossils, doInfluenceExalt, doMatron, doMirror, doRemoveCrafted,
  type GameState, type Result, type SpamOptions,
} from '../game/game.ts'
import { boom, buildName, STARTER_DAYS, weekday, type Codex as CodexData } from '../game/meta.ts'
import { compileSearch } from '../game/search.ts'
import { fmtGold, t } from '../i18n.ts'
import { exportFile, importFile, type Settings } from '../save.ts'
import { Bench } from './Bench.tsx'
import { Board, GoalCard } from './Board.tsx'
import { Codex } from './Codex.tsx'
import { Faustus } from './Faustus.tsx'
import type { DropSource } from '../game/specials.ts'
import { Shop, type ShopView } from './Shop.tsx'
import { Popular } from './Popular.tsx'
import { Rivals } from './Rivals.tsx'
import { rivalNewsText } from './rivalText.ts'
import { playerRank } from '../game/rivals.ts'
import { Stash } from './Stash.tsx'
import { TipLayer } from './Tip.tsx'
import { AdvancedMods, useAltHeld } from './advanced.ts'

interface Props {
  lang: Lang
  state: GameState
  setState: (s: GameState) => void
  settings: Settings
  setSettings: (s: Settings) => void
  onMenu: () => void
  codex: CodexData
}

type View = 'bench' | 'shop' | 'faustus' | 'board' | 'codex'

const boomPct = (day: number) => Math.round((boom(day) - 1) * 100)

export function Game({ lang, state, setState, settings, setSettings, onMenu, codex }: Props) {
  const [view, setView] = useState<View>(state.stash.length ? 'bench' : 'shop')
  const [selected, setSelected] = useState<number | null>(state.stash[0]?.uid ?? null)
  const [shopView, setShopView] = useState<ShopView>({ cls: 'Body Armour', query: '', ilvl: 84, scroll: 0, kind: '', lower: false })
  const [notice, setNotice] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const entry = state.stash.find((x) => x.uid === selected)
  const match = useMemo(() => compileSearch(settings.search), [settings.search])
  const alt = useAltHeld()
  const advanced = useMemo(() => ({
    on: alt || !!settings.advancedMods, pinned: !!settings.advancedMods,
    toggle: () => setSettings({ ...settings, advancedMods: !settings.advancedMods }),
  }), [alt, settings, setSettings])
  // The spam machine has its own regex (user), apart from the stash search.
  const spamMatch = useMemo(() => compileSearch(settings.spamSearch ?? ''), [settings.spamSearch])
  // The search lights up (or dims) the item shown in the middle, not the stash list (user).
  const lit = match && entry ? match(searchText(entry.item, lang)) : null
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
    const r = buyBase(state, base, ilvl)
    if (!r.ok && r.error === 'ilvlTooLow') return setNotice(t(lang, 'err_ilvlTooLow', BASES[base].lvl))
    if (run(r)) setSelected(uid)
  }
  const onBuyUnidentified = (source: DropSource, base: string) => {
    sfx('button')
    const uid = state.nextUid
    if (run(buyUnidentified(state, source, base))) setSelected(uid)
  }
  const onCurrency = (c: CurrencyId) => selected !== null && run(doCurrency(state, selected, c))
  const onBench = (i: number) => selected !== null && run(doBench(state, selected, i))
  const onRemoveCrafted = () => selected !== null && run(doRemoveCrafted(state, selected))
  const onEssence = (n: string) => selected !== null && run(doEssence(state, selected, n))
  const onFossils = (ns: string[]) => selected !== null && run(doFossils(state, selected, ns))
  const onMirror = () => selected !== null && run(doMirror(state, selected))
  const onMatron = () => selected !== null && run(doMatron(state, selected))
  const onInfluenceExalt = (n: string) => selected !== null && run(doInfluenceExalt(state, selected, n))
  const onDominance = () => selected !== null && run(doDominance(state, selected))
  const onAwaken = (donor: number) => selected !== null && run(doAwaken(state, donor, selected))
  const onEldritchImplicit = (n: string) => selected !== null && run(doEldritchImplicit(state, selected, n))
  const onEldritchOrb = (n: string) => selected !== null && run(doEldritchOrb(state, selected, n))
  const onHarvest = (id: string) => selected !== null && run(doHarvest(state, selected, id))
  const onBeast = (id: string) => selected !== null && run(doBeast(state, selected, id))
  const onImprint = () => selected !== null && run(doImprint(state, selected))
  const onRestore = () => selected !== null && run(doRestore(state, selected))
  const onVeiledOrb = (n: string) => selected !== null && run(doVeiledOrb(state, selected, n))
  const onRecombine = (other: number) => {
    if (selected === null) return
    const uid = state.nextUid
    if (run(doRecombine(state, selected, other))) setSelected(uid)
  }
  const onReveal = () => selected !== null && run(doReveal(state, selected))
  const onUnveil = (id: string) => selected !== null && run(doUnveil(state, selected, id))
  const onSpam = (o: SpamOptions) => {
    if (!spamMatch || selected === null) return null
    const r = spamAlteration(state, selected, (item) => spamMatch(searchText(item, lang)), o)
    setState(r.state)
    return r
  }

  const openFaustus = () => {
    setView('faustus')
    faustusGreeting()
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
  const onDeliver = (id: number) => {
    if (selected === null) return
    if (actionsLeft <= 0) return setNotice(t(lang, 'deliverNoActions'))
    const reward = state.board?.find((c) => c.id === id)?.reward ?? 0
    const r = deliver(state, selected, id)
    if (!r.ok) return setNotice(errorText(r.error))
    sfx('button')
    setState(r.state)
    setNotice(t(lang, 'delivered', fmtGold(reward)))
    setSelected(r.state.stash[0]?.uid ?? null)
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
    if (!next.finished && state.day === STARTER_DAYS) lines.push(t(lang, 'leagueShift'))
    for (const r of (next.meta.rumors ?? []).slice(state.meta.rumors?.length ?? 0)) {
      lines.push(t(lang, 'rumorLine', r.day, buildName(r.note.build, lang), r.note.day, t(lang, r.note.factor > 1 ? 'patchBuff' : 'patchNerf')))
    }
    const fresh2 = (next.board ?? []).filter((c) => !state.board?.some((x) => x.id === c.id)).length
    if (!next.finished && fresh2) lines.push(t(lang, 'newCommissions', fresh2))
    lines.push(...(next.rivalNews ?? []).map((n) => rivalNewsText(lang, n)))
    if (lines.length) setNotice(lines.join(' / '))
  }

  // Pinned above the item on the bench (user): the top bar's day and gold, and the goal order if one is set.
  const goal = state.board?.find((c) => c.id === state.goal)
  const header = (
    <>
      <div className="status-line">
        <b>{t(lang, 'day', state.day, LAST_DAY)}</b> · {t(lang, 'gold')} <b className={state.gold < 0 ? 'debt' : 'gold'}>{fmtGold(state.gold)}</b>
        {state.pending > 0 && <span className="hint"> (+{fmtGold(state.pending)})</span>} · {t(lang, 'actionsLeft', actionsLeft, ACTIONS_PER_DAY)}
      </div>
      {goal && <GoalCard lang={lang} c={goal} item={entry?.item} day={state.day} open={settings.goalOpen ?? true}
        onToggle={(open) => setSettings({ ...settings, goalOpen: open })} />}
    </>
  )

  const tab = (v: View, label: string) => (
    <button className={view === v ? 'tab active' : 'tab'} onClick={() => (v === 'faustus' ? openFaustus() : setView(v))}>{label}</button>
  )

  return (
    <AdvancedMods.Provider value={advanced}>
    <div className="game">
      <TipLayer />
      <header className="topbar">
        <strong>{t(lang, 'day', state.day, LAST_DAY)} · {t(lang, 'weekdays').split(',')[weekday(state.day)]}</strong>
        {boom(state.day) > 1 && <span className="boom">{t(lang, 'boomBadge', boomPct(state.day))}</span>}
        <span>{t(lang, 'gold')}: <b className={state.gold < 0 ? 'debt' : 'gold'}>{fmtGold(state.gold)}</b></span>
        {state.debt && <span className={state.gold < 0 ? 'debt' : 'hint'}>{t(lang, 'debtBadge')}{state.gold < 0 && ` · ${t(lang, 'debtDays', (state.debtDays ?? 0) + 1, DEBT_DAYS)}`}</span>}
        {state.pending > 0 && <span>{t(lang, 'pending')}: {fmtGold(state.pending)}</span>}
        <span>{t(lang, 'actionsLeft', actionsLeft, ACTIONS_PER_DAY)}</span>
        <span>{t(lang, 'rank', playerRank(state.gold + state.pending, state.rivals), state.rivals.length + 1)}</span>
        <button disabled={actionsLeft <= 0} onClick={onHunt}>{t(lang, 'hunt')}</button>
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
            if (s) setState(upgradeSave(s))
            else setNotice(t(lang, 'importFailed'))
            e.target.value = ''
          }} />
        </div>
      </header>
      {notice && <div className="notice">{notice}</div>}

      <div className="layout">
        <div className="side">
          <Stash
            lang={lang}
            stash={state.stash}
            selected={selected}
            onSelect={(uid) => { sfx('itemPickup'); setSelected(uid); if (view === 'shop') setView('bench') }}
            search={settings.search}
            onSearch={(q) => setSettings({ ...settings, search: q })}
          />
          <Rivals lang={lang} gold={state.gold} pending={state.pending} rivals={state.rivals} />
        </div>
        <div className="main">
          <Popular lang={lang} meta={state.meta} day={state.day} open={settings.popularOpen ?? true}
            onToggle={(open) => setSettings({ ...settings, popularOpen: open })} />
          <nav className="tabs">
            {tab('bench', t(lang, 'bench'))}
            {tab('shop', t(lang, 'shop'))}
            {tab('faustus', t(lang, 'faustus'))}
            {tab('board', t(lang, 'board'))}
            {tab('codex', t(lang, 'codex'))}
          </nav>
          {/* Tabs only hide when another one is open (user: going to the shop and back mustn't reset the bench's tab,
              fossils, spam settings, open groups...). Faustus is drawn only when open: its quote is the costly part. */}
          <div hidden={view !== 'bench'}>
            <Bench lang={lang} entry={entry} gold={spendable(state)} day={state.day} canSpam={!!spamMatch} lit={lit}
              spamSearch={settings.spamSearch ?? ''} onSpamSearch={(q) => setSettings({ ...settings, spamSearch: q })}
              onCurrency={onCurrency} onBench={onBench} onRemoveCrafted={onRemoveCrafted} onMatron={onMatron} onEssence={onEssence}
              onFossils={onFossils} onMirror={onMirror} onSpam={onSpam} onFaustus={openFaustus}
              stash={state.stash} onInfluenceExalt={onInfluenceExalt} onDominance={onDominance} onAwaken={onAwaken}
              onEldritchImplicit={onEldritchImplicit} onEldritchOrb={onEldritchOrb} onHarvest={onHarvest}
              onBeast={onBeast} onImprint={onImprint} onRestore={onRestore}
              onVeiledOrb={onVeiledOrb} onReveal={onReveal} onUnveil={onUnveil} onRecombine={onRecombine} header={header} />
          </div>
          <div hidden={view !== 'shop'}>
            <Shop lang={lang} state={state} view={shopView} onView={setShopView} onBuy={onBuy} onBuyUnidentified={onBuyUnidentified} />
          </div>
          <div hidden={view !== 'board'}>
            <Board lang={lang} board={state.board ?? []} day={state.day} meta={state.meta} entry={entry} canSell={actionsLeft > 0} onDeliver={onDeliver}
              goal={state.goal} onGoal={(id) => setState({ ...state, goal: id })} onDismiss={(id) => run(dismissCommission(state, id))} />
          </div>
          <div hidden={view !== 'codex'}>
            <Codex lang={lang} codex={codex} meta={state.meta} day={state.day} />
          </div>
          {view === 'faustus' && (
            <Faustus lang={lang} entry={entry} day={state.day} meta={state.meta} canSell={actionsLeft > 0} lit={lit}
              onSell={onSell} onBack={() => setView('bench')} />
          )}
        </div>
      </div>
    </div>
    </AdvancedMods.Provider>
  )
}
