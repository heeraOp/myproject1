import { WS_BASE_URL } from '../../config.js'

const MAX_RECONNECT_ATTEMPTS = 10
const BASE_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 15000

class SocketManager {
  constructor() {
    this.socket = null
    this.gameId = null
    this.shouldReconnect = false
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.messageHandlers = new Map()
    this.lifecycleHandlers = new Map()
    this.wasReconnectAttempt = false
  }

  buildUrl(gameId) {
    const baseUrl = String(WS_BASE_URL || '').replace(/\/+$/, '')
    const safeGameId = String(gameId).replace(/^\/+|\/+$/g, '')
    return `${baseUrl}/ws/games/${safeGameId}/`
  }

  connect(gameId) {
    if (!gameId) {
      throw new Error('gameId is required to open websocket connection.')
    }

    if (
      this.socket &&
      this.gameId === gameId &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return this.socket
    }

    this.clearReconnectTimer()
    this.closeSocket()

    this.gameId = gameId
    this.shouldReconnect = true
    this.socket = new WebSocket(this.buildUrl(gameId))
    this.attachSocketEvents()

    return this.socket
  }

  disconnect() {
    this.shouldReconnect = false
    this.clearReconnectTimer()
    this.closeSocket()
    this.gameId = null
    this.reconnectAttempts = 0
    this.wasReconnectAttempt = false
  }

  reconnect() {
    if (!this.gameId) return
    this.connect(this.gameId)
  }

  subscribe(type, handler) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set())
    }
    this.messageHandlers.get(type).add(handler)

    return () => {
      const handlers = this.messageHandlers.get(type)
      if (!handlers) return
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.messageHandlers.delete(type)
      }
    }
  }

  on(eventName, handler) {
    if (!this.lifecycleHandlers.has(eventName)) {
      this.lifecycleHandlers.set(eventName, new Set())
    }
    this.lifecycleHandlers.get(eventName).add(handler)

    return () => {
      const handlers = this.lifecycleHandlers.get(eventName)
      if (!handlers) return
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.lifecycleHandlers.delete(eventName)
      }
    }
  }

  send(data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false
    }

    this.socket.send(JSON.stringify(data))
    return true
  }

  getState() {
    return {
      gameId: this.gameId,
      readyState: this.socket ? this.socket.readyState : WebSocket.CLOSED,
      reconnectAttempts: this.reconnectAttempts,
      connected: Boolean(this.socket && this.socket.readyState === WebSocket.OPEN),
    }
  }

  attachSocketEvents() {
    if (!this.socket) return

    this.socket.onopen = () => {
      this.reconnectAttempts = 0
      const eventName = this.wasReconnectAttempt ? 'reconnect' : 'connect'
      this.wasReconnectAttempt = false
      this.emitLifecycle(eventName)
    }

    this.socket.onmessage = (event) => {
      console.log('RAW SOCKET MESSAGE:', event.data)
      let payload
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }

      if (!payload || typeof payload !== 'object') {
        return
      }

      const messageType = payload.type
      if (typeof messageType === 'string') {
        this.emitMessage(messageType, payload)
      }
      this.emitMessage('*', payload)
    }

    this.socket.onerror = (error) => {
      this.emitLifecycle('error', error)
    }

    this.socket.onclose = (event) => {
      this.emitLifecycle('disconnect', event)
      this.socket = null

      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    }
  }

  scheduleReconnect() {
    if (!this.gameId) return
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emitLifecycle('reconnect_failed')
      return
    }

    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    )

    this.reconnectAttempts += 1
    this.wasReconnectAttempt = true

    this.clearReconnectTimer()
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnect()
    }, delay)
  }

  emitMessage(type, payload) {
    const handlers = this.messageHandlers.get(type)
    if (!handlers) return
    handlers.forEach((handler) => {
      handler(payload)
    })
  }

  emitLifecycle(eventName, payload) {
    const handlers = this.lifecycleHandlers.get(eventName)
    if (!handlers) return
    handlers.forEach((handler) => {
      handler(payload)
    })
  }

  clearReconnectTimer() {
    if (!this.reconnectTimer) return
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  closeSocket() {
    if (!this.socket) return
    this.socket.onopen = null
    this.socket.onmessage = null
    this.socket.onerror = null
    this.socket.onclose = null
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close()
    }
    this.socket = null
  }
}

export const socketManager = new SocketManager()
