// Instant hover help: anything with a data-tip attribute shows it the moment the pointer is on it. The browser's own
// title tooltip waits about a second (user: "takes all day"). One fixed layer for the whole screen, so scrolling lists
// can't clip it; it sits below the element, or above when there's no room.
import { useEffect, useState } from 'react'

interface Shown { text: string; x: number; y: number; above: boolean }
const EDGE = 180 // keep a centred tip of max-width 340px on screen
const HOLD_MS = 400 // a touch this long is a look, not a press

export function TipLayer() {
  const [tip, setTip] = useState<Shown | null>(null)
  useEffect(() => {
    let current: Element | null = null
    const show = (el: Element | null) => {
      current = el
      const text = el?.getAttribute('data-tip')
      if (!el || !text) return setTip(null)
      const r = el.getBoundingClientRect()
      const above = r.bottom + 90 > window.innerHeight
      const x = Math.min(window.innerWidth - EDGE, Math.max(EDGE, r.left + r.width / 2))
      setTip({ text, x, y: above ? r.top - 6 : r.bottom + 6, above })
    }
    const over = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null
      if (el !== current) show(el)
    }
    // A finger leaving the screen is not the pointer leaving: the tip stays until the next tap or scroll.
    const out = (e: PointerEvent) => { if (!e.relatedTarget && e.pointerType !== 'touch') show(null) }
    const hide = () => show(null)
    // Phones have no hover: holding a button shows its tip, and letting go after a hold doesn't press it.
    let held = 0
    const down = (e: PointerEvent) => { held = e.pointerType === 'touch' ? e.timeStamp : 0 }
    const click = (e: MouseEvent) => {
      if (held && e.timeStamp - held > HOLD_MS && e.target instanceof Element && e.target.closest('[data-tip]')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const menu = (e: Event) => { if (e.target instanceof Element && e.target.closest('[data-tip]')) e.preventDefault() }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('click', click, true)
    document.addEventListener('contextmenu', menu)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('click', click, true)
      document.removeEventListener('contextmenu', menu)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])
  if (!tip) return null
  return <div className={`tip ${tip.above ? 'above' : ''}`} style={{ left: tip.x, top: tip.y }}>{tip.text}</div>
}
