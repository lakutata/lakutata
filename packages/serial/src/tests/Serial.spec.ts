import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {listSerialPorts, openSerialPort, SerialException, type SerialPort} from '../exports/Serial.js'

/**
 * A pseudo-terminal pair opened by Python: the path of its slave (the port), its master echoing what the port sends;
 * the echo ends when its input is closed
 */
const ECHO: string = `
import os, pty, select, sys
master, slave = pty.openpty()
print(os.ttyname(slave), flush=True)
while True:
    ready, _, _ = select.select([master, 0], [], [])
    if 0 in ready and not os.read(0, 1024):
        break
    if master in ready:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        while data:
            data = data[os.write(master, data):]
`

async function echoTerminal(): Promise<{path: string, close: () => Promise<void>}> {
    const child: ChildProcessWithoutNullStreams = spawn('python3', ['-c', ECHO], {stdio: 'pipe'})
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

describe('The serial ports', {skip: process.platform === 'win32' && 'no pseudo-terminals on Windows'}, (): void => {
    it('sends and receives through a port: what it writes comes back from the echo', async (): Promise<void> => {
        const terminal = await echoTerminal()
        const port: SerialPort = await openSerialPort({path: terminal.path, baudRate: 115200})
        try {
            assert.strictEqual(port.path, terminal.path)
            assert.strictEqual(port.baudRate, 115200)
            const data: Buffer = randomBytes(200000)
            const back: Promise<Buffer> = received(port, data.length)
            port.write(data)
            await port.drain()
            assert.ok((await back).equals(data))
        } finally {
            await port.close()
            await terminal.close()
        }
        assert.ok(port.destroyed)
    })

    it('changes the settings of its line, and refuses the wrong ones', async (): Promise<void> => {
        const terminal = await echoTerminal()
        const port: SerialPort = await openSerialPort({path: terminal.path})
        try {
            assert.deepStrictEqual(port.settings, {baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none'})
            port.update({baudRate: 38400, parity: 'even', dataBits: 7, flowControl: 'xon/xoff'})
            assert.deepStrictEqual(port.settings, {baudRate: 38400, dataBits: 7, stopBits: 1, parity: 'even', flowControl: 'xon/xoff'})
            assert.throws((): void => port.update({dataBits: 9 as 8}), (error: SerialException): boolean => error instanceof SerialException && error.code === 'EINVAL')
            assert.throws((): void => port.update({baudRate: -1}), SerialException)
            port.update({dataBits: 8, parity: 'none', flowControl: 'none'})
            //A pseudo-terminal has no modem lines on some systems: the lines, or the exception
            try {
                assert.strictEqual(typeof port.getSignals().cts, 'boolean')
            } catch (error) {
                assert.ok(error instanceof SerialException)
            }
            port.flush()
            const back: Promise<Buffer> = received(port, 5)
            port.write('hello')
            assert.strictEqual((await back).toString(), 'hello')
        } finally {
            await port.close()
            await terminal.close()
        }
    })

    it('refuses what it cannot open: no such port, not a serial port, a port open elsewhere', async (): Promise<void> => {
        await assert.rejects(openSerialPort({path: '/dev/lakutata-no-such-port'}), (error: SerialException): boolean => error instanceof SerialException && error.code === 'ENOENT')
        await assert.rejects(openSerialPort({path: '/dev/null'}), (error: SerialException): boolean => error instanceof SerialException && error.code === 'ENOTTY')
        await assert.rejects(openSerialPort({path: ''}), SerialException)
        await assert.rejects(openSerialPort({path: '/dev/null', stopBits: 3 as 2}), (error: SerialException): boolean => error.code === 'EINVAL')
        const terminal = await echoTerminal()
        const port: SerialPort = await openSerialPort({path: terminal.path})
        try {
            await assert.rejects(openSerialPort({path: terminal.path}), (error: SerialException): boolean => error instanceof SerialException && error.code === 'EBUSY')
            const shared: SerialPort = await openSerialPort({path: terminal.path, exclusive: false}).catch((error: SerialException): SerialPort => {
                //Exclusive for the other openings until it is closed
                assert.strictEqual(error.code, 'EBUSY')
                return port
            })
            if (shared !== port) await shared.close()
        } finally {
            await port.close()
            await terminal.close()
        }
    })

    it('is closed at once while it reads, its data not sent discarded', async (): Promise<void> => {
        const terminal = await echoTerminal()
        const port: SerialPort = await openSerialPort({path: terminal.path})
        try {
            port.on('data', (): void => undefined)
            await new Promise<void>((resolve): void => {
                setTimeout(resolve, 250)
            })
            const started: number = Date.now()
            port.destroy()
            await once(port, 'close')
            assert.ok(Date.now() - started < 1000, `closed in ${Date.now() - started} ms`)
            await assert.rejects(port.drain())
        } finally {
            await terminal.close()
        }
    })

    it('fails its reads when the other end goes away', async (): Promise<void> => {
        const terminal = await echoTerminal()
        const port: SerialPort = await openSerialPort({path: terminal.path})
        const failed: Promise<unknown[]> = once(port, 'error')
        port.resume()
        await terminal.close()
        const [error] = await failed
        assert.ok(error instanceof SerialException)
        assert.strictEqual((error as SerialException).code, 'EIO')
        if (!port.closed) await once(port, 'close')
    })

    it('lists the ports of the system', async (): Promise<void> => {
        const ports = await listSerialPorts()
        assert.ok(Array.isArray(ports))
        for (const port of ports) assert.strictEqual(typeof port.path, 'string')
    })
})
