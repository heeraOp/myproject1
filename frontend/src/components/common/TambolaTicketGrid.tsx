import { memo, type ReactNode } from 'react'
import './TambolaTicketGrid.css'

type TambolaTicketGridProps = {
  children: ReactNode
  className?: string
}

const TambolaTicketGrid = ({ children, className = '' }: TambolaTicketGridProps) => {
  const normalizedClassName = className.trim()
  const rootClassName = normalizedClassName
    ? `tambola-ticket-grid ${normalizedClassName}`
    : 'tambola-ticket-grid'

  return <div className={rootClassName}>{children}</div>
}

export default memo(TambolaTicketGrid)
