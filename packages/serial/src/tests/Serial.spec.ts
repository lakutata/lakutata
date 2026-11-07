import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {setTimeout as sleep} from 'node:timers/promises'
import {Worker} from 'node:worker_threads'
import {listSerialPorts, openBluetoothSerial, openSerialPort, SerialException, type SerialPort} from '../exports/Serial.js'

/**
 * A pseudo-terminal pair opened by Python: the path of its slave (the port) is printed, its master echoes what the port
 * sends (echo), never reads it (sink: the output stops once the buffers are full), or sends data without end (stream);
 * the terminal closes when the input of Python is closed
 */
const TERMINAL: string = `
import fcntl, os, pty, select, sys
mode = sys.argv[1]
master, slave = pty.openpty()
print(os.ttyname(slave), flush=True)
fcntl.fcntl(master, fcntl.F_SETFL, fcntl.fcntl(master, fcntl.F_GETFL) | os.O_NONBLOCK)
while True:
    watched = [0] + ([master] if mode == 'echo' else [])
    ready, _, _ = select.select(watched, [], [], 0.002 if mode == 'stream' else None)
    if 0 in ready and not os.read(0, 1024):
        break
    if mode == 'stream':
        try:
            os.write(master, b'x' * 256)
        except OSError:
            pass
    if master in ready:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        while data:
            try:
                data = data[os.write(master, data):]
            except BlockingIOError:
                select.select([], [master], [])
`

async function terminal(mode: 'echo' | 'sink' | 'stream' = 'echo'): Promise<{path: string, close: () => Promise<void>}> {
    const child: ChildProcessWithoutNullStreams = spawn('python3', ['-c', TERMINAL, mode], {stdio: 'pipe'})
    const path: string = await new Promise<string>((resolve, reject): void => {
        let output: string = ''
        child.stdout.on('data', (data: Buffer): void => {
            output += data.toString()
            if (output.includes('\n')) resolve(output.slice(0, output.indexOf('\n')))
        })
        child.once('error', reject)
        child.once('exit', (code: number | null): void => reject(new Error(`python3 exited (${code})`)))
    })
    return {
        path,
        close: async (): Promise<void> => {
            if (child.exitCode !== null) return
            child.stdin.end()
            await once(child, 'exit')
        }
    }
}

async function received(port: SerialPort, length: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let size: number = 0
    return await new Promise<Buffer>((resolve, reject): void => {
        const data = (chunk: Buffer): void => {
            chunks.push(chunk)
            size += chunk.length
            if (size >= length) {
                port.off('data', data)
                port.off('error', reject)
                port.pause()
                resolve(Buffer.concat(chunks))
            }
        }
        port.on('data', data)
        port.once('error', reject)
    })
}

function failed(code: string): (error: unknown) => boolean {
    return (error: unknown): boolean => error instanceof SerialException && error.code === code
}

describe('The serial ports on every system', (): void => {
    it('refuses what it cannot open, and the options it does not take', async (): Promise<void> => {
        const missing: string = process.platform === 'win32' ? 'COM199' : '/dev/lakutata-no-such-port'
        await assert.rejects(openSerialPort({path: missing}), failed('ENOENT'))
        await assert.rejects(openSerialPort({path: missing, stopBits: 1.5, dataBits: 8}), failed('EINVAL'))
        await assert.rejects(openSerialPort({path: missing, flowControl: 'rts/dtr' as 'rts/cts'}), failed('EINVAL'))
        await assert.rejects(openBluetoothSerial({address: '00:11:22:33:44'}), failed('EINVAL'))
        const ports = await listSerialPorts()
        assert.ok(Array.isArray(ports))
        for (const port of ports) assert.strictEqual(typeof port.path, 'string')
    })
})

describe('The serial ports', {skip: process.platform === 'win32' && 'no pseudo-terminals on Windows'}, (): void => {
    it('sends and receives through a port: what it writes comes back from the echo', async (): Promise<void> => {
        const pair = await terminal()
        const port: SerialPort = await openSerialPort({path: pair.path, baudRate: 115200})
        try {
            assert.strictEqual(port.path, pair.path)
            assert.strictEqual(port.baudRate, 115200)
            const data: Buffer = randomBytes(200000)
            const back: Promise<Buffer> = received(port, data.length)
            port.write(data)
            await port.drain()
            assert.ok((await back).equals(data))
        } finally {
            await port.close()
            await pair.close()
        }
        assert.ok(port.destroyed)
    })

    it('keeps the order of many small writes, sent together', async (): Promise<void> => {
        const pair = await terminal()
        const port: SerialPort = await openSerialPort({path: pair.path, baudRate: 115200})
        try {
            const chunks: Buffer[] = Array.from({length: 2000}, (_value: unknown, index: number): Buffer => Buffer.from(`${index},`))
            const expected: Buffer = Buffer.concat(chunks)
            const back: Promise<Buffer> = received(port, expected.length)
            for (const chunk of chunks) port.write(chunk)
            assert.strictEqual((await back).toString(), expected.toString())
        } finally {
            await port.close()
            await pair.close()
        }
    })

    it('changes the settings of its line, and refuses the wrong ones', async (): Promise<void> => {
        const pair = await terminal()
        const port: SerialPort = await openSerialPort({path: pair.path})
        try {
            assert.deepStrictEqual(port.settings, {baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', stallTimeout: 0})
            await port.update({baudRate: 38400, stopBits: 2, flowControl: 'xon/xoff'})
            assert.deepStrictEqual(port.settings, {baudRate: 38400, dataBits: 8, stopBits: 2, parity: 'none', flowControl: 'xon/xoff', stallTimeout: 0})
            //A pseudo-terminal of Linux keeps 8 data bits and no parity whatever it is told: refused (by the system, or
            //by the reading back of the settings, a dropped setting not being ignored); the one of macOS takes them
            try {
                await port.update({dataBits: 7, parity: 'even'})
                assert.strictEqual(port.settings.parity, 'even')
            } catch (error) {
                assert.ok(failed('EINVAL')(error), String(error))
                assert.strictEqual(port.settings.parity, 'none')
            }
            await assert.rejects(port.update({dataBits: 9 as 8}), failed('EINVAL'))
            await assert.rejects(port.update({baudRate: -1}), SerialException)
            await port.update({dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none'})
            //A pseudo-terminal has no modem lines on some systems: the lines, or the exception
            try {
                assert.strictEqual(typeof (await port.getSignals()).cts, 'boolean')
            } catch (error) {
                assert.ok(error instanceof SerialException)
            }
            await port.flush()
            const back: Promise<Buffer> = received(port, 5)
            port.write('hello')
            assert.strictEqual((await back).toString(), 'hello')
        } finally {
            await port.close()
            await pair.close()
        }
    })

    it('refuses what it cannot open: no such port, not a serial port, a port open elsewhere', async (): Promise<void> => {
        await assert.rejects(openSerialPort({path: '/dev/lakutata-no-such-port'}), failed('ENOENT'))
        await assert.rejects(openSerialPort({path: '/dev/null'}), failed('ENOTTY'))
        await assert.rejects(openSerialPort({path: ''}), SerialException)
        await assert.rejects(openSerialPort({path: '/dev/null', stopBits: 3 as 2}), failed('EINVAL'))
        const pair = await terminal()
        const port: SerialPort = await openSerialPort({path: pair.path})
        try {
            await assert.rejects(openSerialPort({path: pair.path}), failed('EBUSY'))
        } finally {
            await port.close()
            await pair.close()
        }
    })

    it('keeps reading while its input is flushed again and again (an emptied queue is not a hang-up)', async (): Promise<void> => {
        const pair = await terminal('stream')
        const port: SerialPort = await openSerialPort({path: pair.path, baudRate: 115200})
        try {
            let bytes: number = 0
            port.on('data', (data: Buffer): void => {
                bytes += data.length
            })
            for (let round = 0; round < 300; round++) await port.flush('input')
            const before: number = bytes
            await sleep(100)
            assert.ok(!port.destroyed)
            assert.ok(bytes > before, 'the data still come')
        } finally {
            await port.close()
            await pair.close()
        }
    })

    it('fails a write when the output stops moving for longer than its stall timeout', async (): Promise<void> => {
        const pair = await terminal('sink')
        const port: SerialPort = await openSerialPort({path: pair.path, stallTimeout: 300})
        try {
            const started: number = Date.now()
            const error: unknown = await new Promise<unknown>((resolve): void => {
                port.write(Buffer.alloc(4 * 1024 * 1024), resolve)
            })
            assert.ok(failed('ETIMEDOUT')(error), String(error))
            assert.ok(Date.now() - started < 3000)
            await assert.rejects(port.close(), failed('ETIMEDOUT'))
            assert.ok(port.closed)
        } finally {
            await pair.close()
        }
    })

    it('closes within its stall timeout when the output stopped, the data discarded', async (): Promise<void> => {
        const pair = await terminal('sink')
        const port: SerialPort = await openSerialPort({path: pair.path})
        try {
            port.on('error', (): void => undefined)
            port.write(Buffer.alloc(4 * 1024 * 1024))
            await sleep(100)
            const started: number = Date.now()
            await assert.rejects(port.close({stallTimeout: 300}), failed('ETIMEDOUT'))
            assert.ok(port.closed)
            assert.ok(Date.now() - started < 3000, `closed in ${Date.now() - started} ms`)
            //Closed for good: open again at once
            const again: SerialPort = await openSerialPort({path: pair.path})
            await again.close()
        } finally {
            await pair.close()
        }
    })

    it('settles a break within its time limit while the output is held (the system waits for it first)', async (): Promise<void> => {
        const pair = await terminal('sink')
        const port: SerialPort = await openSerialPort({path: pair.path})
        try {
            port.write(Buffer.alloc(100))
            await new Promise<void>((resolve): void => {
                port.write(Buffer.alloc(0), (): void => resolve())
            })
            const started: number = Date.now()
            try {
                await port.setSignals({break: true})
                await port.setSignals({break: false})
            } catch (error) {
                //Held output (Linux), or no break on a pseudo-terminal
                assert.ok(error instanceof SerialException && ['ETIMEDOUT', 'ENOTTY', 'EINVAL'].includes(error.code ?? ''), String(error))
            }
            assert.ok(Date.now() - started < 5000, `settled in ${Date.now() - started} ms`)
            //The port still answers
            await port.flush()
        } finally {
            port.destroy()
            await once(port, 'close')
            await pair.close()
        }
    })

    it('takes the flow controls the system offers, and the frames its UARTs take', async (): Promise<void> => {
        await assert.rejects(openSerialPort({path: '/dev/null', stopBits: 1.5, dataBits: 8}), failed('EINVAL'))
        const pair = await terminal()
        const port: SerialPort = await openSerialPort({path: pair.path})
        try {
            for (const flowControl of ['rts/cts', 'dtr/dsr'] as const) {
                try {
                    await port.update({flowControl})
                    if (flowControl === 'dtr/dsr') assert.notStrictEqual(process.platform, 'linux', 'DTR/DSR on Linux')
                } catch (error) {
                    //No DTR/DSR flow control on Linux; a pseudo-terminal may refuse the hardware ones
                    assert.ok(failed('EINVAL')(error), String(error))
                    if (process.platform === 'linux' && flowControl === 'dtr/dsr') assert.match((error as Error).message, /not offered/)
                }
            }
            await port.update({flowControl: 'none'})
        } finally {
            await port.close()
            await pair.close()
        }
    })

    it('is closed at once while it reads, its data not sent discarded', async (): Promise<void> => {
        const pair = await terminal()
        const port: SerialPort = await openSerialPort({path: pair.path})
        try {
            port.on('data', (): void => undefined)
            await sleep(250)
            const started: number = Date.now()
            port.destroy()
            await once(port, 'close')
            assert.ok(Date.now() - started < 1000, `closed in ${Date.now() - started} ms`)
            await assert.rejects(port.drain())
        } finally {
            await pair.close()
        }
    })

    it('fails when the other end goes away, while it reads or not', async (): Promise<void> => {
        for (const reading of [true, false]) {
            const pair = await terminal()
            const port: SerialPort = await openSerialPort({path: pair.path})
            const failure: Promise<unknown[]> = once(port, 'error')
            if (reading) port.resume()
            await pair.close()
            const [error] = await failure
            assert.ok(error instanceof SerialException)
            assert.strictEqual((error as SerialException).code, 'EIO')
            assert.strictEqual((error as SerialException).disconnected, true)
            if (!port.closed) await once(port, 'close')
        }
    })

    it('is closed when the worker that opened it ends', async (): Promise<void> => {
        const pair = await terminal()
        try {
            const worker: Worker = new Worker(`
                const {parentPort, workerData} = require('node:worker_threads')
                import(workerData.module).then(async ({openSerialPort}) => {
                    const port = await openSerialPort({path: workerData.path})
                    port.write('from the worker')
                    parentPort.postMessage('open')
                })
            `, {eval: true, workerData: {module: new URL('../exports/Serial.js', import.meta.url).href, path: pair.path}})
            await once(worker, 'message')
            await worker.terminate()
            //Its port closed with the worker: open again at once (exclusive)
            const port: SerialPort = await openSerialPort({path: pair.path})
            await port.close()
        } finally {
            await pair.close()
        }
    })

    it('opens a Bluetooth device by its address, and refuses what it cannot open', async (): Promise<void> => {
        await assert.rejects(openBluetoothSerial({address: 'printer'}), failed('EINVAL'))
        await assert.rejects(openBluetoothSerial({address: '00:11:22:33:44:55', channel: 31}), failed('EINVAL'))
        //No paired device of that address (macOS), no Bluetooth (a container), no device answering (Linux)
        const started: number = Date.now()
        await assert.rejects(openBluetoothSerial({address: '00-11-22-33-44-55', openTimeout: 3000}), (error: unknown): boolean => error instanceof SerialException && typeof error.code === 'string')
        assert.ok(Date.now() - started < 6000, `failed in ${Date.now() - started} ms`)
    })

    it('lists the ports of the system', async (): Promise<void> => {
        const ports = await listSerialPorts()
        assert.ok(Array.isArray(ports))
        for (const port of ports) assert.strictEqual(typeof port.path, 'string')
    })
})
