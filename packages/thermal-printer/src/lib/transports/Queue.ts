import {execFile, spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {Writable} from 'node:stream'
import {promisify} from 'node:util'
import {ThermalPrinterConnectionException} from '../../exceptions/ThermalPrinterConnectionException.js'
import {addon} from '../Native.js'
import {type Channel, messageOf, streamChannel} from '../Stream.js'

/**
 * A print queue of the system, as listed
 */
export interface QueueInfo {
    name: string
    //Where the queue sends its jobs: a device URI of CUPS (usb://…, socket://…), a port of Windows (USB001, COM3…)
    device?: string
    driver?: string
}

/**
 * The print queues of CUPS: lpstat -v (device for NAME: URI), in the C locale; none when CUPS is not there
 */
async function cupsQueues(): Promise<QueueInfo[]> {
    try {
        const {stdout} = await promisify(execFile)('lpstat', ['-v'], {timeout: 15000, env: {...process.env, LANG: 'C', LC_ALL: 'C'}})
        const queues: QueueInfo[] = []
        for (const line of stdout.split('\n')) {
            const match: RegExpMatchArray | null = line.match(/^device for (.+?):\s*(.+)$/)
            if (match) queues.push({name: match[1]!, device: match[2]!.trim()})
        }
        return queues
    } catch {
        return []
    }
}

/**
 * The print queues of the system: CUPS on macOS and Linux, the spooler on Windows
 */
export async function listQueues(): Promise<QueueInfo[]> {
    if (process.platform !== 'win32') return await cupsQueues()
    return (await addon().queueList()).map((queue): QueueInfo => ({name: queue.name, device: queue.port, driver: queue.driver}))
}

/**
 * A queue of CUPS: lp, the commands on its input, sent raw
 */
function cupsChannel(name: string): Channel {
    const child: ChildProcessWithoutNullStreams = spawn('lp', ['-d', name, '-o', 'raw'], {stdio: 'pipe'})
    let errors: string = ''
    child.stderr.on('data', (data: Buffer): void => {
        errors += data.toString()
    })
    const exited: Promise<number | null> = new Promise<number | null>((resolve, reject): void => {
        child.once('error', (error: Error): void => reject(new ThermalPrinterConnectionException(`lp cannot be run (CUPS): ${messageOf(error)}`)))
        child.once('close', (code: number | null): void => resolve(code))
    })
    exited.catch((): void => undefined)
    return streamChannel(child.stdin, async (): Promise<void> => {
        const code: number | null = await exited
        if (code !== 0) throw new ThermalPrinterConnectionException(`lp failed for the queue ${name} (${code}): ${errors.trim()}`)
    })
}

/**
 * A printer of the spooler of Windows: the commands gathered, then sent as one raw document when the print ends
 */
function spoolerChannel(name: string): Channel {
    const chunks: Buffer[] = []
    const gathered: Writable = new Writable({
        write: (chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void => {
            chunks.push(chunk)
            callback()
        }
    })
    return streamChannel(gathered, async (): Promise<void> => {
        try {
            await addon().queuePrint(name, Buffer.concat(chunks), 'lakutata')
        } catch (error) {
            throw new ThermalPrinterConnectionException(`The spooler refused the print for ${name}: ${messageOf(error)}`)
        }
    })
}

/**
 * A print queue of the system, opened for one print
 * @param name
 */
export function openQueue(name: string): Channel {
    return process.platform === 'win32' ? spoolerChannel(name) : cupsChannel(name)
}
