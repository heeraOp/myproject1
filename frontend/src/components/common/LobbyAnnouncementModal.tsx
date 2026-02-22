import { useEffect, useRef } from 'react'
import './LobbyAnnouncementModal.css'

type LobbyAnnouncementModalProps = {
  open: boolean
  title: string
  content: string
  accepting: boolean
  errorMessage?: string
  onAccept: () => void
}

const LobbyAnnouncementModal = ({
  open,
  title,
  content,
  accepting,
  errorMessage = '',
  onAccept,
}: LobbyAnnouncementModalProps) => {
  const acceptButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    const previousOverscrollBehavior = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.setTimeout(() => {
      acceptButtonRef.current?.focus()
    }, 0)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscrollBehavior
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="lobby-announcement-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lobby-announcement-title"
    >
      <section className="lobby-announcement-modal__card">
        <h2 id="lobby-announcement-title" className="lobby-announcement-modal__title">
          {title}
        </h2>
        <div className="lobby-announcement-modal__content">{content}</div>
        {errorMessage ? <p className="lobby-announcement-modal__error">{errorMessage}</p> : null}
        <button
          ref={acceptButtonRef}
          type="button"
          className="lobby-announcement-modal__accept-btn"
          onClick={onAccept}
          disabled={accepting}
        >
          {accepting ? 'ACCEPTING...' : 'I ACCEPT'}
        </button>
      </section>
    </div>
  )
}

export default LobbyAnnouncementModal
