import {connect, type Socket} from 'node:net'
import type {Server} from 'node:http'

/**
 * Take over the upgrade requests of a server as a WebSocket server of the application does (socket.io, ws, the hot
 * reload of a development server): answered 101, their socket kept open
 * @param server
 */
export function takeOverUpgrades(server: Server): void {
    server.on('upgrade', (_request: unknown, socket: Socket): void => void socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n'))
}

/**
 * Send an upgrade request: the connection and the status line of its answer
 * @param url
 */
export function upgrade(url: string): Promise<{ socket: Socket, status: string }> {
    const {hostname, port} = new URL(url)
    return new Promise((resolve: (value: { socket: Socket, status: string }) => void, reject: (error: Error) => void): void => {
        const socket: Socket = connect(Number(port), hostname, (): void => void socket.write(`GET / HTTP/1.1\r\nHost: ${hostname}\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n`))
        socket.once('error', reject).once('data', (data: Buffer): void => resolve({socket: socket, status: data.toString().split('\r\n')[0]}))
    })
}

/**
 * The time a function takes, in milliseconds
 * @param run
 */
export async function durationOf(run: () => Promise<unknown>): Promise<number> {
    const started: number = Date.now()
    await run()
    return Date.now() - started
}
