import type { Lang } from '../game/describe.ts'
import type { Rival } from '../game/rivals.ts'
import { fmtGold, t, tList } from '../i18n.ts'
import { rankRows } from './rivalText.ts'

// **bold** only; enough for the credit text
const rich = (s: string) => s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))

export function LanguageSelect({ onPick }: { onPick: (l: Lang) => void }) {
  return (
    <main className="screen">
      <h1>ExileCraftSomething</h1>
      <p>언어를 선택하세요 · Choose your language</p>
      <div className="menu">
        <button onClick={() => onPick('ko')}>한국어</button>
        <button onClick={() => onPick('en')}>English</button>
      </div>
    </main>
  )
}

interface StartProps {
  lang: Lang
  best: number
  canContinue: boolean
  onNew: () => void
  onContinue: () => void
  onCredits: () => void
  onCodex: () => void
}

export function StartMenu({ lang, best, canContinue, onNew, onContinue, onCredits, onCodex }: StartProps) {
  return (
    <main className="screen">
      <h1>{t(lang, 'title')}</h1>
      {best > 0 && <p>{t(lang, 'bestScore')}: {fmtGold(best)}</p>}
      <div className="menu">
        <button className={canContinue ? '' : 'primary'} onClick={onNew}>{t(lang, 'newRun')}</button>
        <button className={canContinue ? 'primary' : ''} disabled={!canContinue} onClick={onContinue}>{t(lang, 'continue')}</button>
        <button onClick={onCodex}>{t(lang, 'codex')}</button>
        <button onClick={onCredits}>{t(lang, 'credits')}</button>
      </div>
    </main>
  )
}

// Always on screen (outside every menu) so the language can be switched any time.
export function LanguageSwitch({ lang, onPick }: { lang: Lang; onPick: (l: Lang) => void }) {
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      <button className={lang === 'ko' ? 'active' : ''} onClick={() => onPick('ko')}>한국어</button>
      <button className={lang === 'en' ? 'active' : ''} onClick={() => onPick('en')}>English</button>
    </div>
  )
}

export function Credits({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const body = tList(lang, 'creditsBody')
  return (
    <main className="screen credits">
      <h1>{t(lang, 'credits')}</h1>
      <div className="credits-text">
        {body.map((line, i) => (line.startsWith('- ')
          ? <p key={i} className="bullet">{rich(line.slice(2))}</p>
          : <p key={i}>{rich(line)}</p>))}
      </div>
      <div className="menu"><button onClick={onBack}>{t(lang, 'back')}</button></div>
    </main>
  )
}

interface RunOverProps { lang: Lang; score: number; isBest: boolean; rivals: Rival[]; onNew: () => void; onMenu: () => void }
export function RunOver({ lang, score, isBest, rivals, onNew, onMenu }: RunOverProps) {
  return (
    <main className="screen">
      <h1>{t(lang, 'runOver')}</h1>
      <p className="big">{t(lang, 'finalScore', fmtGold(score))}</p>
      {isBest && <p className="best">{t(lang, 'newBest')}</p>}
      <h3>{t(lang, 'finalRanking')}</h3>
      <ol className="final-ranking">
        {rankRows(lang, score, rivals).map((r) => (
          <li key={r.key} className={r.key === 'you' ? 'you' : ''}>{r.name}{r.note && <small> · {r.note}</small>} — {fmtGold(r.gold)}</li>
        ))}
      </ol>
      <div className="menu">
        <button className="primary" onClick={onNew}>{t(lang, 'newRun')}</button>
        <button onClick={onMenu}>{t(lang, 'toStartMenu')}</button>
      </div>
    </main>
  )
}
