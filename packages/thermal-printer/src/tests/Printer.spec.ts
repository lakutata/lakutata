import {describe, it} from 'node:test'
import assert from 'node:assert'
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {createServer, type AddressInfo, type Server, type Socket} from 'node:net'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {encode, render} from '@lakutata/thermal'
import {
    buildThermalPrinterOptions,
    ThermalPrinter,
    ThermalPrinterConnectionException,
    ThermalPrinterException
} from '../exports/ThermalPrinter.js'

/**
 * A printer on the network: a server that keeps what each connection sends, a connection at a time as printers take them
 */
async function fakePrinter(): Promise<{port: number, jobs: Buffer[], close: () => Promise<void>}> {
    const jobs: Buffer[] = []
    const server: Server = createServer({allowHalfOpen: false}, (socket: Socket): void => {
        const chunks: Buffer[] = []
        socket.on('data', (chunk: Buffer): void => {
            chunks.push(chunk)
        })
        socket.on('end', (): void => {
            jobs.push(Buffer.concat(chunks))
            socket.end()
        })
    })
    server.maxConnections = 1
    await new Promise<void>((resolve): void => {
        server.listen(0, '127.0.0.1', resolve)
    })
    return {
        port: (server.address() as AddressInfo).port,
        jobs,
        close: (): Promise<void> => new Promise<void>((resolve): void => {
            server.close((): void => resolve())
        })
    }
}

async function component(options: Parameters<typeof buildThermalPrinterOptions>[0]): Promise<{printers: ThermalPrinter, container: Container}> {
    const container: Container = new Container()
    const {class: type, ...rest} = buildThermalPrinterOptions(options)
    await container.setNamed('printers', type, rest)
    return {printers: await container.get<ThermalPrinter>('printers'), container}
}

const HTML: string = '<h1 style="text-align:center">湖畔咖啡</h1><p>Latte ¥32.00</p>'

describe('The thermal printer component', (): void => {
    it('prints HTML on a network printer: the commands of encode(), each print in its order', async (): Promise<void> => {
        const printer = await fakePrinter()
        const {printers, container} = await component({printers: {front: {connection: {type: 'network', host: '127.0.0.1', port: printer.port}, paper: 80, commands: {language: 'escpos', cut: 'partial'}}}})
        try {
            const expected: Buffer = encode(await render(HTML, {paper: 80}), {language: 'escpos', cut: 'partial'})
            const results = await Promise.all([printers.print('front', HTML), printers.print('front', '<p>second</p>'), printers.print('front', Buffer.from([0x1B, 0x40, 0x0A]))])
            assert.deepStrictEqual(results.map((result): number => result.pages), [1, 1, 0])
            assert.strictEqual(printer.jobs.length, 3)
            assert.ok(printer.jobs[0]!.equals(expected))
            assert.strictEqual(results[0]!.bytes, expected.length)
            //In their order: the second one ends with the cut too, the raw one as it is
            assert.deepStrictEqual([...printer.jobs[1]!.subarray(-4)], [0x1D, 0x56, 0x42, 0x00])
            assert.deepStrictEqual([...printer.jobs[2]!], [0x1B, 0x40, 0x0A])
            //The options of a print over the printer's own
            await printers.print('front', HTML, {commands: {cut: false}})
            assert.ok(printer.jobs[3]!.equals(encode(await render(HTML, {paper: 80}), {language: 'escpos'})))
            assert.deepStrictEqual(printers.printerNames(), ['front'])
        } finally {
            await container.destroy()
            await printer.close()
        }
    })

    it('previews and encodes without printing, for a named printer or one given', async (): Promise<void> => {
        const {printers, container} = await component({printers: {band: {connection: {type: 'queue', name: 'none'}, model: 'HC100', label: {width: 25, height: 250}, commands: {sensor: 'mark'}}}})
        try {
            const preview = await printers.preview('band', '<b>Ward 3</b>')
            assert.deepStrictEqual([preview.width, preview.height, preview.dpi], [300, 3000, 300])
            const commands: Buffer = await printers.commands('band', preview)
            assert.ok(commands.toString('latin1').startsWith('^XA^PW300^LL3000^MNM'))
            const given = await printers.preview({connection: {type: 'network', host: 'localhost'}, paper: 58}, '<p>x</p>')
            assert.strictEqual(given.width, 384)
        } finally {
            await container.destroy()
        }
    })

    it('sends to a print queue by lp, raw', {skip: process.platform === 'win32'}, async (): Promise<void> => {
        //A stub of lp on the PATH: its arguments and its input kept in files
        const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-lp-'))
        const stub: string = path.join(directory, 'lp')
        writeFileSync(stub, `#!/bin/sh\necho "$@" > "${directory}/arguments"\ncat > "${directory}/input"\n`)
        chmodSync(stub, 0o755)
        const previous: string | undefined = process.env.PATH
        process.env.PATH = `${directory}${path.delimiter}${previous}`
        const {printers, container} = await component({printers: {labels: {connection: {type: 'queue', name: 'TSC_TDP225'}, label: {width: 40, height: 30}, dpi: 203, commands: {language: 'tspl'}}}})
        try {
            const result = await printers.print('labels', '<b>Shelf A-12</b>')
            assert.strictEqual(readFileSync(path.join(directory, 'arguments'), 'utf8').trim(), '-d TSC_TDP225 -o raw')
            const input: Buffer = readFileSync(path.join(directory, 'input'))
            assert.strictEqual(input.length, result.bytes)
            assert.ok(input.toString('latin1').startsWith('SIZE 40 mm,30 mm\r\n'))
            //lp failing: its error
            writeFileSync(stub, '#!/bin/sh\necho "lp: The printer or class does not exist." >&2\nexit 1\n')
            await assert.rejects(printers.print('labels', '<b>x</b>'), ThermalPrinterConnectionException)
        } finally {
            process.env.PATH = previous
            await container.destroy()
            rmSync(directory, {recursive: true, force: true})
        }
    })

    it('fails the prints it cannot send, and the next ones still go out', async (): Promise<void> => {
        const printer = await fakePrinter()
        const {printers, container} = await component({printers: {
            front: {connection: {type: 'network', host: '127.0.0.1', port: printer.port}, paper: 58, commands: {language: 'escpos'}},
            closed: {connection: {type: 'network', host: '127.0.0.1', port: 1}, paper: 58, commands: {language: 'escpos'}, connectTimeout: 2000},
            serial: {connection: {type: 'serial', path: '/dev/null'}, paper: 58, commands: {language: 'escpos'}}
        }})
        try {
            await assert.rejects(printers.print('closed', '<p>x</p>'), ThermalPrinterConnectionException)
            await assert.rejects(printers.print('nowhere', '<p>x</p>'), ThermalPrinterException)
            //Not a serial port: the error of @lakutata/serial, as the one of the connection
            await assert.rejects(printers.print('serial', '<p>x</p>'), (error: Error): boolean => error instanceof ThermalPrinterConnectionException && /ENOTTY|serial port/i.test(error.message))
            //A connection whose package is not installed
            await assert.rejects(printers.print({connection: {type: 'bluetooth', address: '00:11:22:33:44:55'}, paper: 58, commands: {language: 'escpos'}}, '<p>x</p>'), (error: Error): boolean => error instanceof ThermalPrinterException && /@lakutata\/bluetooth/.test(error.message))
            await printers.print('front', '<p>x</p>')
            assert.strictEqual(printer.jobs.length, 1)
            const controller: AbortController = new AbortController()
            controller.abort()
            await assert.rejects(printers.print('front', '<p>x</p>', {signal: controller.signal}))
        } finally {
            await container.destroy()
            await printer.close()
        }
    })

    it('fails a print whose printer drops the connection while it is sent', async (): Promise<void> => {
        //A printer that closes the connection at the first data it receives
        const server: Server = createServer((socket: Socket): void => {
            socket.once('data', (): void => {
                socket.destroy()
            })
        })
        await new Promise<void>((resolve): void => {
            server.listen(0, '127.0.0.1', resolve)
        })
        const {printers, container} = await component({printers: {dropping: {connection: {type: 'network', host: '127.0.0.1', port: (server.address() as AddressInfo).port}, bytesPerSecond: 200000}}})
        try {
            await assert.rejects(printers.print('dropping', Buffer.alloc(2 * 1024 * 1024)), ThermalPrinterConnectionException)
        } finally {
            await container.destroy()
            await new Promise<void>((resolve): void => {
                server.close((): void => resolve())
            })
        }
    })

    it('fails a print the printer stops taking (out of paper) within its stall timeout', async (): Promise<void> => {
        //A printer that reads nothing: its buffers fill, then the connection takes no more
        const sockets: Socket[] = []
        const server: Server = createServer((socket: Socket): void => {
            socket.pause()
            sockets.push(socket)
        })
        await new Promise<void>((resolve): void => {
            server.listen(0, '127.0.0.1', resolve)
        })
        const {printers, container} = await component({printers: {jammed: {connection: {type: 'network', host: '127.0.0.1', port: (server.address() as AddressInfo).port}, stallTimeout: 500}}})
        try {
            const started: number = Date.now()
            await assert.rejects(printers.print('jammed', Buffer.alloc(64 * 1024 * 1024)), (error: Error): boolean => error instanceof ThermalPrinterConnectionException && /took no data/.test(error.message))
            assert.ok(Date.now() - started < 10000, `failed in ${Date.now() - started} ms`)
        } finally {
            await container.destroy()
            for (const socket of sockets) socket.destroy()
            await new Promise<void>((resolve): void => {
                server.close((): void => resolve())
            })
        }
    })

    it('paces a slow link to its bytes a second', async (): Promise<void> => {
        const printer = await fakePrinter()
        const {printers, container} = await component({printers: {slow: {connection: {type: 'network', host: '127.0.0.1', port: printer.port}, bytesPerSecond: 20000}}})
        try {
            const started: number = Date.now()
            await printers.print('slow', Buffer.alloc(6000))
            const elapsed: number = Date.now() - started
            assert.ok(elapsed >= 250, `${elapsed} ms for 6000 bytes at 20000 a second`)
            assert.strictEqual(printer.jobs[0]!.length, 6000)
        } finally {
            await container.destroy()
            await printer.close()
        }
    })
})
