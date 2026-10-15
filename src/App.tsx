import { useEffect, useState } from 'react'
import { setAudio } from './audio.ts'
import type { Lang } from './game/describe.ts'
import { ensureMeta, newGame, type GameState } from './game/game.ts'
import { loadBest, loadGame, loadSettings, saveBest, saveGame, saveSettings, type Settings } from './save.ts'
import { Game } from './ui/Game.tsx'
import { Credits, LanguageSelect, LanguageSwitch, RunOver, StartMenu } from './ui/Screens.tsx'

type Screen = 'lang' | 'start' | 'credits' | 'game'

function App() {
  const [settings, setSettingsState] = useState(loadSettings)
  const [game, setGameState] = useState<GameState | null>(() => { const g = loadGame(); return g && ensureMeta(g) })
  const [best, setBest] = useState(loadBest)
  const [screen, setScreen] = useState<Screen>(settings.lang ? 'start' : 'lang')
  const lang: Lang = settings.lang ?? 'ko'

  useEffect(() => setAudio(settings.volume, settings.muted), [settings.volume, settings.muted])

  const setSettings = (s: Settings) => {
    setSettingsState(s)
    saveSettings(s)
  }
  // Autosave after every action, so a reload can't reroll anything.
  const setGame = (s: GameState) => {
    setGameState(s)
    saveGame(s)
    if (s.finished && s.finished.score > best) {
      setBest(s.finished.score)
      saveBest(s.finished.score)
    }
  }
  const startNew = () => {
    setGame(newGame((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0))
    setScreen('game')
  }

  // First launch: pick a language. After that the switch stays on screen.
  if (screen === 'lang') {
    return <LanguageSelect onPick={(l) => { setSettings({ ...settings, lang: l }); setScreen('start') }} />
  }
  const switcher = <LanguageSwitch lang={lang} onPick={(l) => setSettings({ ...settings, lang: l })} />
  if (screen === 'credits') return <>{switcher}<Credits lang={lang} onBack={() => setScreen('start')} /></>
  if (screen === 'game' && game) {
    if (game.finished) {
      return <>{switcher}<RunOver lang={lang} score={game.finished.score} isBest={game.finished.score >= best}
        onNew={startNew} onMenu={() => setScreen('start')} /></>
    }
    return <>{switcher}<Game lang={lang} state={game} setState={setGame} settings={settings} setSettings={setSettings}
      onMenu={() => setScreen('start')} /></>
  }
  return (
    <>
      {switcher}
      <StartMenu
        lang={lang}
        best={best}
        canContinue={!!game && !game.finished}
        onNew={startNew}
        onContinue={() => setScreen('game')}
        onCredits={() => setScreen('credits')}
      />
    </>
  )
}

export default App
