import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'

export interface JournalSection {
  id: string
  label: string
}

interface Props {
  sections: JournalSection[]
  /** The Real / Practice / All switch, when there are practice trades */
  accountSwitch: ReactNode
  onLogTrade: () => void
}

/**
 * Bar that stays under the site menu while the Journal scrolls: jump links to
 * each section (the one in view is highlighted), the account switch and Log
 * trade, so they are always in reach.
 */
const JournalNav = ({ sections, accountSwitch, onLogTrade }: Props) => {
  const barRef = useRef<HTMLElement>(null)
  const linksRef = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)
  const [active, setActive] = useState(sections[0]?.id ?? '')

  // Sit right under the sticky site menu, and tell sections how far to stop below the bar
  useLayoutEffect(() => {
    const menu = document.querySelector<HTMLElement>('.navigation')
    const bar = barRef.current
    const measure = () => {
      const menuHeight = menu?.getBoundingClientRect().height ?? 0
      setTop(menuHeight)
      document.documentElement.style.setProperty('--jn-offset', `${Math.round(menuHeight + (bar?.offsetHeight ?? 0) + 12)}px`)
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (menu) observer?.observe(menu)
    if (bar) observer?.observe(bar)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      document.documentElement.style.removeProperty('--jn-offset')
    }
  }, [])

  // Highlight the section whose heading has passed under the bar
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const offset = (barRef.current?.getBoundingClientRect().bottom ?? 0) + 24
      let current = sections[0]?.id ?? ''
      for (const s of sections) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= offset) current = s.id
      }
      // At the very bottom, the last section counts even if its heading is lower
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections.at(-1)?.id ?? current
      setActive(current)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [sections])

  // Keep the active link visible in the bar on narrow screens (without scrolling the page)
  useEffect(() => {
    const row = linksRef.current
    const link = row?.querySelector<HTMLElement>(`[data-section="${active}"]`)
    if (!row || !link || row.scrollWidth <= row.clientWidth) return
    row.scrollTo({ left: link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2, behavior: 'smooth' })
  }, [active])

  // Opening /journal#trades jumps to that section once the page has drawn
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!sections.some(s => s.id === id)) return
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 400)
    return () => clearTimeout(timer)
  }, [sections])

  const jump = (e: React.MouseEvent, id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    e.preventDefault()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    history.replaceState(null, '', `#${id}`)
    setActive(id)
    // Move keyboard focus to the section so the next Tab continues from there
    el.focus({ preventScroll: true })
  }

  return (
    <nav className="jn-bar" ref={barRef} style={{ top }} aria-label="Journal sections">
      <div className="jn-links" ref={linksRef}>
        {sections.map(s => (
          <a
            key={s.id}
            href={`#${s.id}`}
            data-section={s.id}
            className={active === s.id ? 'active' : ''}
            aria-current={active === s.id ? 'location' : undefined}
            onClick={e => jump(e, s.id)}
          >
            {s.label}
          </a>
        ))}
      </div>
      <div className="jn-bar-actions">
        {accountSwitch}
        <button type="button" className="jn-log" onClick={onLogTrade}>
          <Plus size={16} aria-hidden="true" />
          <span>Log trade</span>
        </button>
      </div>
    </nav>
  )
}

export default JournalNav
