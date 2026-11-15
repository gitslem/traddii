import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search } from 'lucide-react'
import { POPULAR_PAIRS, OTHER_PAIRS, customPair, pairToSymbol, symbolToPair } from '../config/pairs'
import './PairSelect.css'

interface PairSelectProps {
  /** Current value: 'BTC/USDT', or 'BTCUSDT' when format is 'symbol' */
  value: string
  onChange: (value: string) => void
  format?: 'pair' | 'symbol'
  /** Class for the trigger, so each page can style it like its other fields */
  className?: string
  ariaLabel?: string
  /** Let the user type a pair that is not on the list (used by the Journal) */
  allowCustom?: boolean
}

/** Searchable pair picker: type to filter, arrows to move, Enter to pick */
const PairSelect = ({ value, onChange, format = 'pair', className = '', ariaLabel = 'Trading pair', allowCustom = false }: PairSelectProps) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
  const listId = useId()

  const current = format === 'symbol' ? symbolToPair(value) : value
  const label = (pair: string) => (format === 'symbol' ? pairToSymbol(pair) : pair)

  // Popular first, then A-Z; while searching, matches that start with the query come first
  const sections = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/[\s/]/g, '')
    if (!q) return [{ title: 'Popular', items: POPULAR_PAIRS }, { title: 'All pairs A-Z', items: OTHER_PAIRS }]
    const all = [...POPULAR_PAIRS, ...OTHER_PAIRS]
    const starts = all.filter(p => pairToSymbol(p).startsWith(q))
    const contains = all.filter(p => !starts.includes(p) && pairToSymbol(p).includes(q))
    return [{ title: '', items: [...starts, ...contains] }]
  }, [query])
  // A typed pair that is not on the list is offered as the last option
  const typedPair = useMemo(() => {
    const typed = allowCustom && query.trim() ? customPair(query) : null
    return typed && !POPULAR_PAIRS.includes(typed) && !OTHER_PAIRS.includes(typed) ? typed : null
  }, [allowCustom, query])
  const flat = useMemo(() => {
    const listed = sections.flatMap(s => s.items)
    return typedPair ? [...listed, typedPair] : listed
  }, [sections, typedPair])

  const openList = () => {
    setQuery('')
    setActive(Math.max(0, [...POPULAR_PAIRS, ...OTHER_PAIRS].indexOf(current)))
    setOpen(true)
  }

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const pick = (pair: string) => {
    if (pair !== current) onChange(format === 'symbol' ? pairToSymbol(pair) : pair)
    close()
  }

  // The panel lives in <body> so cards can't clip or cover it; keep it under
  // the trigger (or above it when there is no room below)
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const r = trigger.getBoundingClientRect()
      const gutter = 16
      const width = Math.min(Math.max(r.width, 240), window.innerWidth - gutter * 2)
      const left = Math.min(Math.max(r.left, gutter), window.innerWidth - gutter - width)
      const below = window.innerHeight - r.bottom
      const up = below < 300 && r.top > below
      const accent = getComputedStyle(trigger).getPropertyValue('--pair-accent').trim()
      setPanelStyle({
        left,
        width,
        ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
        ['--pair-list-max' as string]: `${Math.max(160, Math.min(320, (up ? r.top : below) - 80))}px`,
        ...(accent ? { ['--pair-accent' as string]: accent } : {})
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus({ preventScroll: true })
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) close(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  // Keep the highlighted option in view
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(flat.length - 1) }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[active]) pick(flat[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'Tab') close(false)
  }

  let index = -1
  return (
    <div className="pair-select" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`pair-select-trigger ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${label(current)}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={e => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openList() }
        }}
      >
        <span>{label(current)}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div className="pair-select-panel" ref={panelRef} style={panelStyle}>
          <div className="pair-select-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
              aria-label="Search pairs"
              placeholder={allowCustom ? 'Search or type any pair' : 'Search, e.g. LINK'}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(0) }}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul className="pair-select-list" role="listbox" id={listId} ref={listRef} aria-label={ariaLabel}>
            {flat.length === 0 && <li className="pair-select-empty">No pair matches "{query}"</li>}
            {sections.map(section => (
              <li key={section.title || 'results'} role="presentation">
                {section.title && <div className="pair-select-group" aria-hidden="true">{section.title}</div>}
                <ul role="presentation">
                  {section.items.map(pair => {
                    index++
                    const i = index
                    return (
                      <li
                        key={pair}
                        id={`${listId}-${i}`}
                        data-index={i}
                        role="option"
                        aria-selected={pair === current}
                        className={`pair-select-option${i === active ? ' active' : ''}${pair === current ? ' selected' : ''}`}
                        onMouseMove={() => setActive(i)}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => pick(pair)}
                      >
                        <span className="pair-base">{pair.split('/')[0]}</span>
                        <span className="pair-quote">/{pair.split('/')[1]}</span>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
            {typedPair && (
              <li
                id={`${listId}-${flat.length - 1}`}
                data-index={flat.length - 1}
                role="option"
                aria-selected={typedPair === current}
                className={`pair-select-option pair-select-custom${flat.length - 1 === active ? ' active' : ''}`}
                onMouseMove={() => setActive(flat.length - 1)}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(typedPair)}
              >
                <span className="pair-quote">Use&nbsp;</span>
                <span className="pair-base">{typedPair}</span>
              </li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  )
}

export default PairSelect
