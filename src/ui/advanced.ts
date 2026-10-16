// "자세히 보기" (user): the game's Advanced Mod Descriptions on item tooltips, each option's kind, tier and tags and the
// range of every number. A toggle kept in the settings, and on while Alt is held, as in the game.
import { createContext, useEffect, useState } from 'react'

export interface Advanced { on: boolean; pinned: boolean; toggle: () => void }
export const AdvancedMods = createContext<Advanced>({ on: false, pinned: false, toggle: () => {} })

export function useAltHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    // preventDefault: a lone Alt would otherwise move focus to the browser's menu on Windows.
    const key = (on: boolean) => (e: KeyboardEvent) => { if (e.key === 'Alt') { e.preventDefault(); setHeld(on) } }
    const down = key(true)
    const up = key(false)
    const off = () => setHeld(false) // Alt+Tab away: the key-up never comes
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
    }
  }, [])
  return held
}
