import type {Server, Socket} from 'node:net'

/**
 * Track the connections of a server, to destroy the ones its `closeAllConnections()` leaves open: the connections taken
 * over by an upgrade (a WebSocket: socket.io, ws, the hot reload of a development server) or by a CONNECT request,
 * which hold the close of the server forever. Unlike a listener of 'upgrade', it does not change how the server answers
 * the requests (without one, an upgrade request is answered as any request).
 * @param server The server whose connections are tracked, before it listens.
 * @returns A function destroying the connections still open.
 */
export function trackConnections(server: Server): () => void {
    const sockets: Set<Socket> = new Set()
    server.on('connection', (socket: Socket): void => {
        sockets.add(socket)
        socket.once('close', (): boolean => sockets.delete(socket))
    })
    return (): void => sockets.forEach((socket: Socket): void => void socket.destroy())
}
