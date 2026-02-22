import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { fetchGameMeta, type GameMetaResponse } from '@/api/rest/games'
import { formatDateInIST, formatTimeInIST } from '@/utils/dateTime'
import './GameMetaTopSheet.css'

type GameMetaTopSheetProps = {
  refreshKey?: string | null
  gameNameOverride?: string | null
  ticketPriceOverride?: number | null
  gameStatusOverride?: string | null
  gameDateOverride?: string | null
  bookingStatusOverride?: string | null
  websiteStatusOverride?: string | null
}

const SWIPE_THRESHOLD_PX = 46

const DEFAULT_HOW_TO_PLAY = [
  'Numbers are called live during the game.',
  'Numbers on your ticket are marked automatically when called.',
  'Prize claims are detected automatically by the system.',
  'Rewards are calculated automatically based on completed patterns.',
  'Final prize distribution is done manually by the admin.',
  'Sheet bonuses apply based on ticket count.',
];

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

const normalizeStatusToken = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')

const toDateTimeLabel = (value: string | null | undefined): string => {
  const raw = String(value ?? '').trim()
  if (!raw) return 'Not announced'
  const datePart = formatDateInIST(raw)
  const timePart = formatTimeInIST(raw)
  if (datePart === '--/--/----' || timePart === '--:--:--') return 'Not announced'
  return `${datePart} ${timePart}`
}

type PrizePatternDetail = {
  prize_type: string
  label: string
  explanation: string
}

const GameMetaTopSheet = ({
  refreshKey,
  gameNameOverride,
  gameStatusOverride,
  gameDateOverride,
  bookingStatusOverride,
  websiteStatusOverride,
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

  const resolvedGameStatus = useMemo(() => {
    const normalizedOverride = normalizeStatusToken(gameStatusOverride)
    if (normalizedOverride) return normalizedOverride
    return meta?.is_live ? 'RUNNING' : 'CREATED'
  }, [gameStatusOverride, meta?.is_live])

  const isLive = useMemo(() => {
    if (resolvedGameStatus === 'RUNNING' || resolvedGameStatus === 'PAUSED') return true
    if (resolvedGameStatus === 'FINISHED' || resolvedGameStatus === 'ENDED') return false
    return Boolean(meta?.is_live)
  }, [meta?.is_live, resolvedGameStatus])

  const bookingStatusLabel = useMemo(() => {
    const normalized = normalizeStatusToken(bookingStatusOverride)
    return normalized ? normalized.replace(/_/g, ' ') : 'UNKNOWN'
  }, [bookingStatusOverride])

  const websiteStatusLabel = useMemo(() => {
    const normalized = normalizeStatusToken(websiteStatusOverride)
    return normalized ? normalized.replace(/_/g, ' ') : 'UNKNOWN'
  }, [websiteStatusOverride])

  const gameDateLabel = useMemo(() => toDateTimeLabel(gameDateOverride), [gameDateOverride])

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
    return `https://api.whatsapp.com/send?phone=${agentWhatsappDigits}&text=${message}`
  }, [agentName, agentWhatsappDigits, gameName])

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
            <span className="game-meta-compact__text-wrap">
              <span className="game-meta-compact__eyebrow">Live Housie Desk</span>
              <span className="game-meta-compact__headline">Game Information</span>
            </span>
          </div>
          <span className="game-meta-compact__right">
            <span className={`game-meta-info-pill${expanded ? ' is-open' : ''}`} aria-hidden="true">
              <span className={`game-meta-live-dot${isLive ? ' is-live' : ''}`} />
              <span className="game-meta-info-pill__label">GAME INFO</span>
              <span className={`game-meta-info-icon${expanded ? ' is-open' : ''}`}>+</span>
            </span>
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
            <h3>Game Snapshot</h3>
            <div className="game-meta-kv-grid">
              <div className="game-meta-kv-card">
                <span>Booking</span>
                <strong>{bookingStatusLabel}</strong>
              </div>
              <div className="game-meta-kv-card">
                <span>Website</span>
                <strong>{websiteStatusLabel}</strong>
              </div>
              <div className="game-meta-kv-card">
                <span>Game Time</span>
                <strong>{gameDateLabel}</strong>
              </div>
            </div>
          </section>

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
                  href={
                    agentWhatsappDigits
                      ? `https://api.whatsapp.com/send?phone=${agentWhatsappDigits}`
                      : undefined
                  }
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
