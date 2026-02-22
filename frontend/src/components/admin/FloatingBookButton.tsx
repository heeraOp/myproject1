import React, { useCallback, useEffect, useRef, useState } from 'react'
import './FloatingBookButton.css'
import SelectTicket from '@/screens/admin-book/SelectTicket'

type Props = {
  gameId?: string
}

const FloatingBookButton: React.FC<Props> = ({ gameId }) => {
  const [open, setOpen] = useState(false)
  const overlayRef = useRef<HTMLDivElement | null>(null)

  const handleOpen = useCallback(() => setOpen(true), [])
  const handleClose = useCallback(() => setOpen(false), [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  // click outside to close
  const onOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      handleClose()
    }
  }

  return (
    <>
      <button className="floating-book-btn" type="button" onClick={handleOpen} aria-label="Open booking">
        BOOK
      </button>

      {open && (
        <div className="floating-book-modal" ref={overlayRef} onClick={onOverlayClick} role="dialog" aria-modal>
          <div className="floating-book-modal__panel">
            <button className="floating-book-modal__close" onClick={handleClose} aria-label="Close booking">
              ×
            </button>
            <SelectTicket gameId={gameId} />
          </div>
        </div>
      )}
    </>
  )
}

export default FloatingBookButton
