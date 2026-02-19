declare module '@/api/websocket/socketManager' {
  export const socketManager: {
    connect: (gameId: string) => WebSocket
    disconnect: () => void
    send: (data: unknown) => boolean
    subscribe: (type: string, handler: (payload: unknown) => void) => () => void
    on: (eventName: string, handler: (payload?: unknown) => void) => () => void
  }
}
