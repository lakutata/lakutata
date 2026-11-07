import {connect, type Socket} from 'node:net'
import {ThermalPrinterConnectionException} from '../../exceptions/ThermalPrinterConnectionException.js'
import {type Channel, messageOf, streamChannel} from '../Stream.js'

/**
 * A printer on the network: a socket to its port, connected within the time limit, closed after each print (printers
 * on port 9100 often take one client at a time)
 * @param host
 * @param port
 * @param timeout
 */
export async function openNetwork(host: string, port: number, timeout: number): Promise<Channel> {
    const socket: Socket = await new Promise<Socket>((resolve, reject): void => {
        const opened: Socket = connect({host, port})
        const timer: NodeJS.Timeout = setTimeout((): void => {
            opened.destroy()
            reject(new ThermalPrinterConnectionException(`The printer ${host}:${port} did not answer within ${timeout} ms`))
        }, timeout)
        opened.once('connect', (): void => {
            clearTimeout(timer)
            resolve(opened)
        })
        opened.once('error', (error: Error): void => {
            clearTimeout(timer)
            reject(new ThermalPrinterConnectionException(`The printer ${host}:${port} cannot be reached: ${messageOf(error)}`))
        })
    })
    return streamChannel(socket, (): Promise<void> => new Promise<void>((resolve): void => {
        //Our end sent (the data handed to the system, which sends them before its FIN): the printer closes its side, or
        //the socket is closed a second later
        if (socket.destroyed) return resolve()
        const timer: NodeJS.Timeout = setTimeout((): void => {
            socket.destroy()
        }, 1000)
        socket.once('close', (): void => {
            clearTimeout(timer)
            resolve()
        })
    }))
}
