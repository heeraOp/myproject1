import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { fetchGameMeta, type GameMetaResponse } from '@/api/rest/games'
import './GameMetaTopSheet.css'

type GameMetaTopSheetProps = {
  refreshKey?: string | null
  gameNameOverride?: string | null
  ticketPriceOverride?: number | null
  gameStatusOverride?: string | null
}

const SWIPE_THRESHOLD_PX = 46

const DEFAULT_HOW_TO_PLAY = [
  'Numbers are called live.',
  'Mark numbers on your ticket.',
  'Claim prize patterns before others.',
  'Sheet bonuses apply based on ticket count.',
  'Claims are verified by admin.',
]

const normalizeWhatsAppDigits = (value: string): string => value.replace(/\D/g, '')

const toHowToPlayItems = (raw: string | undefined): string[] => {
  const text = String(raw ?? '').trim()
  if (!text) return DEFAULT_HOW_TO_PLAY

  const byNewLine = text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (byNewLine.length > 1) return byNewLine

  const bySentence = text
    .split(/[.!?]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return bySentence.length > 0 ? bySentence : DEFAULT_HOW_TO_PLAY
}

type PrizePatternDetail = {
  prize_type: string
  label: string
  explanation: string
}

const GameMetaTopSheet = ({
  refreshKey,
  gameNameOverride,
  ticketPriceOverride,
  gameStatusOverride,
}: GameMetaTopSheetProps) => {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [meta, setMeta] = useState<GameMetaResponse | null>(null)

  const openSwipeStartY = useRef<number | null>(null)
  const closeSwipeStartY = useRef<number | null>(null)

  const loadMeta = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await fetchGameMeta()
      setMeta(payload)
    } catch {
      setMeta(null)
      setError('Unable to load game information right now.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta, refreshKey])

  useEffect(() => {
    if (!expanded) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [expanded])

  const gameName = useMemo(() => {
    const override = String(gameNameOverride ?? '').trim()
    if (override) return override
    const value = String(meta?.game_name ?? '').trim()
    return value || 'Tambola Game'
  }, [gameNameOverride, meta?.game_name])

  const ticketPrice = useMemo(() => {
    const override = Number(ticketPriceOverride ?? 0)
    if (Number.isFinite(override) && override > 0) return override
    const value = Number(meta?.ticket_price ?? 0)
    return Number.isFinite(value) && value > 0 ? value : 0
  }, [ticketPriceOverride, meta?.ticket_price])

  const isLive = useMemo(() => {
    const status = String(gameStatusOverride ?? '').trim().toUpperCase()
    if (status) return status === 'RUNNING'
    return Boolean(meta?.is_live)
  }, [gameStatusOverride, meta?.is_live])

  const agentName = useMemo(() => {
    const value = String(meta?.agent_name ?? '').trim()
    return value || 'Agent'
  }, [meta?.agent_name])

  const agentWhatsappDigits = useMemo(
    () => normalizeWhatsAppDigits(String(meta?.agent_whatsapp ?? '')),
    [meta?.agent_whatsapp],
  )

  const agentWhatsAppDisplay = useMemo(() => {
    if (!agentWhatsappDigits) return 'Not available'
    if (agentWhatsappDigits.startsWith('91') && agentWhatsappDigits.length === 12) {
      return `+${agentWhatsappDigits}`
    }
    return `+${agentWhatsappDigits}`
  }, [agentWhatsappDigits])

  const paymentMode = useMemo(() => {
    const value = String(meta?.payment_mode ?? '').trim()
    return value || 'Manual via WhatsApp'
  }, [meta?.payment_mode])

  const howToPlayItems = useMemo(() => toHowToPlayItems(meta?.how_to_play), [meta?.how_to_play])

  const prizePatterns = useMemo(() => {
    const entries = Array.isArray(meta?.prize_patterns)
      ? meta.prize_patterns
          .map((item) => String(item).trim())
          .filter((item) => item.length > 0)
      : []
    return entries
  }, [meta?.prize_patterns])

  const prizePatternDetails = useMemo<PrizePatternDetail[]>(() => {
    if (Array.isArray(meta?.prize_pattern_details)) {
      const normalized = meta.prize_pattern_details
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const prizeType = String((item as { prize_type?: unknown }).prize_type ?? '').trim()
          const label = String((item as { label?: unknown }).label ?? '').trim()
          const explanation = String((item as { explanation?: unknown }).explanation ?? '').trim()
          if (!label || !explanation) return null
          return {
            prize_type: prizeType || label.toUpperCase().replace(/\s+/g, '_'),
            label,
            explanation,
          }
        })
        .filter((item): item is PrizePatternDetail => item !== null)
      if (normalized.length > 0) return normalized
    }

    return prizePatterns.map((label) => ({
      prize_type: label.toUpperCase().replace(/\s+/g, '_'),
      label,
      explanation: 'Rule is validated server-side when called numbers satisfy the pattern.',
    }))
  }, [meta?.prize_pattern_details, prizePatterns])

  const whatsappHelpLink = useMemo(() => {
    if (!agentWhatsappDigits) return ''
    const message = encodeURIComponent(
      `Hello ${agentName}, I need help with booking for ${gameName}.`,
    )
    return `https://wa.me/${agentWhatsappDigits}?text=${message}`
  }, [agentName, agentWhatsappDigits, gameName])

  const compactLine = `${gameName} • ${ticketPrice > 0 ? `₹${ticketPrice} per ticket` : 'Ticket info unavailable'} • ${
    isLive ? 'LIVE' : 'NOT LIVE'
  }`

  const handleCompactTouchStart = (event: TouchEvent<HTMLButtonElement>) => {
    openSwipeStartY.current = event.touches[0]?.clientY ?? null
  }

  const handleCompactTouchEnd = (event: TouchEvent<HTMLButtonElement>) => {
    if (expanded) {
      openSwipeStartY.current = null
      return
    }
    const start = openSwipeStartY.current
    openSwipeStartY.current = null
    if (start === null) return
    const end = event.changedTouches[0]?.clientY ?? start
    if (end - start >= SWIPE_THRESHOLD_PX) {
      setExpanded(true)
    }
  }

  const handlePanelTouchStart = (event: TouchEvent<HTMLElement>) => {
    closeSwipeStartY.current = event.touches[0]?.clientY ?? null
  }

  const handlePanelTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = closeSwipeStartY.current
    closeSwipeStartY.current = null
    if (start === null) return
    const end = event.changedTouches[0]?.clientY ?? start
    if (start - end >= SWIPE_THRESHOLD_PX) {
      setExpanded(false)
    }
  }

  return (
    <>
      {expanded && (
        <button
          type="button"
          className="game-meta-backdrop"
          aria-label="Close game information panel"
          onClick={() => setExpanded(false)}
        />
      )}

      <div className={`game-meta-top-sheet${expanded ? ' is-open' : ''}`}>
        <button
          type="button"
          className="game-meta-compact"
          aria-expanded={expanded}
          aria-label="Toggle game information"
          onClick={() => setExpanded((prev) => !prev)}
          onTouchStart={handleCompactTouchStart}
          onTouchEnd={handleCompactTouchEnd}
        >
          <div className="game-meta-compact__left">
            <span className="game-meta-trophy" aria-hidden="true">
              🏆
            </span>
            <span className="game-meta-compact__text">{compactLine}</span>
          </div>
          <span className="game-meta-compact__right" aria-hidden="true">
            <span className={`game-meta-live-dot${isLive ? ' is-live' : ''}`} />
            <span className={`game-meta-info-icon${expanded ? ' is-open' : ''}`}>i</span>
          </span>
        </button>

        <section
          className="game-meta-panel"
          role="dialog"
          aria-label="Game information"
          onTouchStart={handlePanelTouchStart}
          onTouchEnd={handlePanelTouchEnd}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="game-meta-panel__header">
            <h2>Game Information</h2>
            {loading && <span className="game-meta-loading">Refreshing...</span>}
          </header>

          {error && <div className="game-meta-error">{error}</div>}

          <section className="game-meta-section">
            <h3>Payment Method</h3>
            <p>Payment is done manually via WhatsApp.</p>
            <p>After booking, you will be redirected to WhatsApp.</p>
            <p>Send cheque/payment confirmation to agent.</p>
            <p>Booking will be confirmed by admin manually.</p>

            <div className="game-meta-agent">
              <div>
                <strong>{agentName}</strong>
                <a
                  href={agentWhatsappDigits ? `https://wa.me/${agentWhatsappDigits}` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={agentWhatsappDigits ? 'is-link' : 'is-disabled'}
                >
                  {agentWhatsAppDisplay}
                </a>
                <small>{paymentMode}</small>
              </div>

              {whatsappHelpLink ? (
                <a
                  className="game-meta-whatsapp-btn"
                  href={whatsappHelpLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp
                </a>
              ) : (
                <span className="game-meta-whatsapp-btn is-disabled">WhatsApp</span>
              )}
            </div>
          </section>

          <section className="game-meta-section">
            <h3>How To Play</h3>
            <ul>
              {howToPlayItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="game-meta-section">
            <h3>Prize Patterns</h3>
            {prizePatternDetails.length > 0 ? (
              <>
                {prizePatterns.length === 0 ? (
                  <p className="game-meta-note">
                    No specific prizes are configured yet. Supported server-side prize rules:
                  </p>
                ) : null}
                <ul className="game-meta-prize-list">
                  {prizePatternDetails.map((pattern) => (
                    <li key={pattern.prize_type}>
                      <strong>{pattern.label}</strong>
                      <span>{pattern.explanation}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>No prize patterns configured yet.</p>
            )}
          </section>
        </section>
      </div>
    </>
  )
}

export default GameMetaTopSheet
