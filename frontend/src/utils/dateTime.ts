const APP_TIME_ZONE = 'Asia/Kolkata'
const APP_LOCALE = 'en-IN'

const parseDate = (value?: string | null): Date | null => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

const getPart = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string =>
  parts.find((part) => part.type === type)?.value ?? ''

export const formatDateTimeInIST = (value?: string | null): string => {
  const date = parseDate(value)
  if (!date) return '-'
  return date.toLocaleString(APP_LOCALE, { timeZone: APP_TIME_ZONE })
}

export const formatDateInIST = (value?: string | null): string => {
  const date = parseDate(value)
  if (!date) return '--/--/----'
  return date.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIME_ZONE })
}

export const formatTimeInIST = (value?: string | null): string => {
  const date = parseDate(value)
  if (!date) return '--:--:--'
  return date.toLocaleTimeString(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export const toDateTimeLocalInputInIST = (value?: string | null): string => {
  const date = parseDate(value)
  if (!date) return ''

  const parts = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const year = getPart(parts, 'year')
  const month = getPart(parts, 'month')
  const day = getPart(parts, 'day')
  const hour = getPart(parts, 'hour')
  const minute = getPart(parts, 'minute')

  if (!year || !month || !day || !hour || !minute) return ''
  return `${year}-${month}-${day}T${hour}:${minute}`
}

export const toISOStringFromInput = (value: string): string | null => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}
