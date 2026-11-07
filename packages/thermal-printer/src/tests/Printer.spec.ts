import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {once} from 'node:events'
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {createServer, type AddressInfo, type Server, type Socket} from 'node:net'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {encode, render, ThermalOptionException} from '@lakutata/thermal'
import {
    buildThermalPrinterManagerOptions,
    type PrinterDefinition,
    ThermalPrinter,
    ThermalPrinterConnectionException,
    ThermalPrinterException,
    type ThermalPrinterManager,
    ThermalPrinterOptionException,
    validatePrinterDefinition
} from '../exports/ThermalPrinter.js'
import {languageOfDeviceId, modelOfDeviceId} from '../lib/DeviceId.js'
import {listLinuxUsbPrinters} from '../lib/transports/Usb.js'

/**
 * A printer on the network: a server that keeps what each connection sends, a connection at a time as printers take them
 */
async function fakePrinter(): Promise<{port: number, jobs: Buffer[], connections: () => number, close: () => Promise<void>}> {
    const jobs: Buffer[] = []
    let connections: number = 0
    const server: Server = createServer({allowHalfOpen: false}, (socket: Socket): void => {
        connections++
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
        connections: (): number => connections,
        close: (): Promise<void> => new Promise<void>((resolve): void => {
            server.close((): void => resolve())
        })
    }
}

async function manager(options: Parameters<typeof buildThermalPrinterManagerOptions>[0] = {}): Promise<{printers: ThermalPrinterManager, container: Container}> {
    const container: Container = new Container()
    const {class: type, ...rest} = buildThermalPrinterManagerOptions(options)
    await container.setNamed('printers', type, rest)
    return {printers: await container.get<ThermalPrinterManager>('printers'), container}
}

/**
 * A pseudo-terminal made raw, as the device file of a printer: what is written to it comes out of Python
 */
async function deviceFile(): Promise<{path: string, received: () => Buffer, close: () => Promise<void>}> {
    const script: string = `
import os, pty, select, sys, tty
master, slave = pty.openpty()
tty.setraw(slave)
print(os.ttyname(slave), flush=True)
while True:
    ready, _, _ = select.select([master, 0], [], [])
    if 0 in ready and not os.read(0, 1024):
        break
    if master in ready:
        sys.stdout.buffer.write(os.read(master, 65536))
        sys.stdout.buffer.flush()
`
    const child: ChildProcessWithoutNullStreams = spawn('python3', ['-c', script], {stdio: 'pipe'})
    const chunks: Buffer[] = []
    const file: string = await new Promise<string>((resolve, reject): void => {
        let output: Buffer = Buffer.alloc(0)
        const read = (data: Buffer): void => {
            output = Buffer.concat([output, data])
            const newline: number = output.indexOf(10)
            if (newline < 0) return
            child.stdout.off('data', read)
            if (output.length > newline + 1) chunks.push(output.subarray(newline + 1))
            child.stdout.on('data', (chunk: Buffer): void => {
                chunks.push(chunk)
            })
            resolve(output.subarray(0, newline).toString())
        }
        child.stdout.on('data', read)
        child.once('error', reject)
    })
    return {
        path: file,
        received: (): Buffer => Buffer.concat(chunks),
        close: async (): Promise<void> => {
            if (child.exitCode !== null) return
            child.stdin.end()
            await once(child, 'exit')
        }
    }
}

const HTML: string = '<h1 style="text-align:center">湖畔咖啡</h1><p>Latte ¥32.00</p>'

describe('The thermal printers', (): void => {
    it('prints on a printer of its configuration by name: the commands of encode(), in the order of the calls', async (): Promise<void> => {
        const printer = await fakePrinter()
        const {printers, container} = await manager({printers: {front: {connection: {type: 'network', host: '127.0.0.1', port: printer.port}, paper: 80, commands: {language: 'escpos', cut: 'partial'}}}})
        try {
            assert.deepStrictEqual(printers.names(), ['front'])
            assert.deepStrictEqual(printers.openPrinters(), [])
            const expected: Buffer = encode(await render(HTML, {paper: 80}), {language: 'escpos', cut: 'partial'})
            const results = await Promise.all([printers.print('front', HTML), printers.print('front', '<p>second</p>'), printers.print('front', Buffer.from([0x1B, 0x40, 0x0A]))])
            assert.deepStrictEqual(results.map((result): number => result.pages), [1, 1, 0])
            assert.strictEqual(printer.jobs.length, 3)
            assert.ok(printer.jobs[0]!.equals(expected))
            assert.strictEqual(results[0]!.bytes, expected.length)
            assert.deepStrictEqual([...printer.jobs[1]!.subarray(-4)], [0x1D, 0x56, 0x42, 0x00])
            assert.deepStrictEqual([...printer.jobs[2]!], [0x1B, 0x40, 0x0A])
            //The options of a print over the printer's own
            await printers.print('front', HTML, {commands: {cut: false}})
            assert.ok(printer.jobs[3]!.equals(encode(await render(HTML, {paper: 80}), {language: 'escpos'})))
            //A network printer is connected for each print
            assert.strictEqual(printer.connections(), 4)
            assert.strictEqual(printers.openPrinters().length, 1)
        } finally {
            await container.destroy()
            await printer.close()
        }
    })

    it('opens a printer from its definition once for its device, its definition saved as JSON and opened again', async (): Promise<void> => {
        const printer = await fakePrinter()
        const {printers, container} = await manager()
        try {
            const definition: PrinterDefinition = {connection: {type: 'network', host: '127.0.0.1', port: printer.port}, paper: 58, commands: {language: 'escpos'}}
            const opened: ThermalPrinter = await printers.open(definition, 'kitchen')
            assert.ok(opened instanceof ThermalPrinter)
            //The same device: the same printer, whatever else its definition says
            assert.strictEqual(await printers.open({...definition, paper: 80}), opened)
            assert.strictEqual(await printers.open({connection: {type: 'network', host: '127.0.0.1', port: printer.port}}), opened)
            assert.strictEqual(await printers.get('kitchen'), opened)
            assert.deepStrictEqual(printers.names(), ['kitchen'])
            //Its definition as JSON: saved, read back, opened again once closed
            const saved: string = JSON.stringify(opened.definition)
            assert.deepStrictEqual(JSON.parse(saved), definition)
            await printers.close('kitchen')
            assert.deepStrictEqual(printers.openPrinters(), [])
            await assert.rejects(opened.print('<p>x</p>'), ThermalPrinterException)
            const again: ThermalPrinter = await printers.open(validatePrinterDefinition(JSON.parse(saved)))
            assert.notStrictEqual(again, opened)
            await again.print('<p>again</p>')
            assert.strictEqual(printer.jobs.length, 1)
        } finally {
            await container.destroy()
            await printer.close()
        }
    })

    it('is one object for a name of the configuration, a new object for each device the manager opens', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            await container.setNamed('front', ThermalPrinter, {connection: {type: 'network', host: '127.0.0.1', port: 9101}, paper: 58})
            const first: ThermalPrinter = await container.get<ThermalPrinter>('front')
            assert.strictEqual(await container.get<ThermalPrinter>('front'), first)
            const {class: type, ...rest} = buildThermalPrinterManagerOptions()
            await container.setNamed('printers', type, rest)
            const printers: ThermalPrinterManager = await container.get<ThermalPrinterManager>('printers')
            const one: ThermalPrinter = await printers.open({connection: {type: 'network', host: '127.0.0.1', port: 9102}})
            const two: ThermalPrinter = await printers.open({connection: {type: 'network', host: '127.0.0.1', port: 9103}})
            assert.notStrictEqual(one, two)
            assert.notStrictEqual(one, first)
            assert.strictEqual(printers.openPrinters().length, 2)
        } finally {
            await container.destroy()
        }
    })

    it('refuses the definitions that are not ones, and media the engine refuses', async (): Promise<void> => {
        const {printers, container} = await manager({printers: {wrong: {connection: {type: 'network', host: 'localhost'}, paper: 33 as 58}}})
        try {
            assert.throws((): void => {
                validatePrinterDefinition({connection: {type: 'usb'}})
            }, ThermalPrinterOptionException)
            assert.throws((): void => {
                validatePrinterDefinition({connection: {type: 'bluetooth', address: 'printer'}})
            }, ThermalPrinterOptionException)
            await assert.rejects(printers.open({connection: {type: 'serial'}} as unknown as PrinterDefinition), ThermalPrinterOptionException)
            await assert.rejects(printers.open({connection: {type: 'network', host: 'localhost'}, paper: 33 as 58}), ThermalOptionException)
            await assert.rejects(printers.get('wrong'), ThermalOptionException)
            await assert.rejects(printers.get('nowhere'), ThermalPrinterException)
            assert.deepStrictEqual(printers.openPrinters(), [])
        } finally {
            await container.destroy()
        }
    })

    it('previews and encodes without printing', async (): Promise<void> => {
        const {printers, container} = await manager({printers: {band: {connection: {type: 'queue', name: 'none'}, model: 'HC100', label: {width: 25, height: 250}, commands: {sensor: 'mark'}}}})
        try {
            const preview = await printers.preview('band', '<b>Ward 3</b>')
            assert.deepStrictEqual([preview.width, preview.height, preview.dpi], [300, 3000, 300])
            const commands: Buffer = await (await printers.get('band')).commandsOf(preview)
            assert.ok(commands.toString('latin1').startsWith('^XA^PW300^LL3000^MNM'))
            const given = await printers.preview({connection: {type: 'network', host: 'localhost'}, paper: 58}, '<p>x</p>')
            assert.strictEqual(given.width, 384)
        } finally {
            await container.destroy()
        }
    })

    it('sends to a print queue by lp, raw, and lists the queues of CUPS', {skip: process.platform === 'win32'}, async (): Promise<void> => {
        //Stubs of lp and lpstat on the PATH: the arguments and the input of lp kept in files
        const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-lp-'))
        const stub: string = path.join(directory, 'lp')
        writeFileSync(stub, `#!/bin/sh\necho "$@" > "${directory}/arguments"\ncat > "${directory}/input"\n`)
        chmodSync(stub, 0o755)
        writeFileSync(path.join(directory, 'lpstat'), '#!/bin/sh\necho "device for TSC_TDP225: usb://TSC/TDP-225?serial=T123"\necho "device for Kitchen: socket://192.168.1.51:9100"\n')
        chmodSync(path.join(directory, 'lpstat'), 0o755)
        const previous: string | undefined = process.env.PATH
        process.env.PATH = `${directory}${path.delimiter}${previous}`
        const {printers, container} = await manager({printers: {labels: {connection: {type: 'queue', name: 'TSC_TDP225'}, label: {width: 40, height: 30}, dpi: 203, commands: {language: 'tspl'}}}})
        try {
            const result = await printers.print('labels', '<b>Shelf A-12</b>')
            assert.strictEqual(readFileSync(path.join(directory, 'arguments'), 'utf8').trim(), '-d TSC_TDP225 -o raw')
            const input: Buffer = readFileSync(path.join(directory, 'input'))
            assert.strictEqual(input.length, result.bytes)
            assert.ok(input.toString('latin1').startsWith('SIZE 40 mm,30 mm\r\n'))
            const queues = await printers.discover({usb: false, serial: false})
            assert.deepStrictEqual(queues.map((candidate): unknown => [candidate.kind, candidate.name, candidate.device, candidate.printer, candidate.connection]), [
                ['queue', 'TSC_TDP225', 'usb://TSC/TDP-225?serial=T123', true, {type: 'queue', name: 'TSC_TDP225'}],
                ['queue', 'Kitchen', 'socket://192.168.1.51:9100', true, {type: 'queue', name: 'Kitchen'}]
            ])
            //lp failing: its error
            writeFileSync(stub, '#!/bin/sh\necho "lp: The printer or class does not exist." >&2\nexit 1\n')
            await assert.rejects(printers.print('labels', '<b>x</b>'), ThermalPrinterConnectionException)
        } finally {
            process.env.PATH = previous
            await container.destroy()
            rmSync(directory, {recursive: true, force: true})
        }
    })

    it('holds the connection of a USB printer (its device file) between its prints', {skip: process.platform === 'win32'}, async (): Promise<void> => {
        const device = await deviceFile()
        const {printers, container} = await manager()
        try {
            const printer: ThermalPrinter = await printers.open({connection: {type: 'usb', path: device.path}, paper: 58, commands: {language: 'escpos'}})
            await printer.print(Buffer.from('first,'))
            await printer.print(Buffer.from('second'))
            for (let tries = 0; tries < 100 && device.received().length < 12; tries++) await new Promise((resolve): void => void setTimeout(resolve, 20))
            assert.strictEqual(device.received().toString(), 'first,second')
            //The device gone: the print fails as its connection
            await device.close()
            await assert.rejects(printer.print(Buffer.alloc(1024 * 1024)), ThermalPrinterConnectionException)
        } finally {
            await container.destroy()
            await device.close()
        }
    })

    it('finds no USB printer where none is plugged, and fails the print of one not connected', async (): Promise<void> => {
        const {printers, container} = await manager()
        try {
            const found = await printers.discover({queues: false, serial: false})
            assert.ok(Array.isArray(found))
            for (const candidate of found) assert.strictEqual(candidate.kind, 'usb')
            await assert.rejects(printers.print({connection: {type: 'usb', vendorId: 0x1234, productId: 0x5678}}, Buffer.from([0x1B, 0x40])), ThermalPrinterConnectionException)
        } finally {
            await container.destroy()
        }
    })

    it('fails the prints it cannot send, and the next ones still go out', async (): Promise<void> => {
        const printer = await fakePrinter()
        const {printers, container} = await manager()
        try {
            const front: PrinterDefinition = {connection: {type: 'network', host: '127.0.0.1', port: printer.port}, paper: 58, commands: {language: 'escpos'}}
            await assert.rejects(printers.print({connection: {type: 'network', host: '127.0.0.1', port: 1}, paper: 58, commands: {language: 'escpos'}, connectTimeout: 2000}, '<p>x</p>'), ThermalPrinterConnectionException)
            //Not a serial port, a Bluetooth printer not paired: the errors of @lakutata/serial as the ones of the connection
            await assert.rejects(printers.print({connection: {type: 'serial', path: '/dev/null'}, paper: 58, commands: {language: 'escpos'}}, '<p>x</p>'), ThermalPrinterConnectionException)
            await assert.rejects(printers.print({connection: {type: 'bluetooth', address: '00:11:22:33:44:55'}, paper: 58, commands: {language: 'escpos'}, connectTimeout: 3000}, '<p>x</p>'), ThermalPrinterConnectionException)
            await printers.print(front, '<p>x</p>')
            assert.strictEqual(printer.jobs.length, 1)
            const controller: AbortController = new AbortController()
            controller.abort()
            await assert.rejects(printers.print(front, '<p>x</p>', {signal: controller.signal}))
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
        const {printers, container} = await manager()
        try {
            await assert.rejects(printers.print({connection: {type: 'network', host: '127.0.0.1', port: (server.address() as AddressInfo).port}, bytesPerSecond: 200000}, Buffer.alloc(2 * 1024 * 1024)), ThermalPrinterConnectionException)
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
        const {printers, container} = await manager()
        try {
            const started: number = Date.now()
            await assert.rejects(printers.print({connection: {type: 'network', host: '127.0.0.1', port: (server.address() as AddressInfo).port}, stallTimeout: 500}, Buffer.alloc(64 * 1024 * 1024)), (error: Error): boolean => error instanceof ThermalPrinterConnectionException && /took no data/.test(error.message))
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
        const {printers, container} = await manager()
        try {
            const started: number = Date.now()
            await printers.print({connection: {type: 'network', host: '127.0.0.1', port: printer.port}, bytesPerSecond: 20000}, Buffer.alloc(6000))
            const elapsed: number = Date.now() - started
            assert.ok(elapsed >= 250, `${elapsed} ms for 6000 bytes at 20000 a second`)
            assert.strictEqual(printer.jobs[0]!.length, 6000)
        } finally {
            await container.destroy()
            await printer.close()
        }
    })

    it('closes its printers with it, their prints sent first', async (): Promise<void> => {
        const printer = await fakePrinter()
        const {printers, container} = await manager({drainTimeout: 5000})
        const opened: ThermalPrinter = await printers.open({connection: {type: 'network', host: '127.0.0.1', port: printer.port}, bytesPerSecond: 20000})
        const printing = opened.print(Buffer.alloc(4000))
        await container.destroy()
        await printing
        assert.strictEqual(printer.jobs[0]!.length, 4000)
        await assert.rejects(opened.print(Buffer.alloc(1)), ThermalPrinterException)
        await printer.close()
    })

    it('finds the USB printers of Linux in sysfs, with the model their IEEE 1284 id names', async (): Promise<void> => {
        //A sysfs: the usblp device lp0 of a USB printer, its interface, its device
        const root: string = mkdtempSync(path.join(tmpdir(), 'lakutata-sysfs-'))
        try {
            const device: string = path.join(root, 'sys/devices/pci0000:00/0000:00:14.0/usb1/1-2')
            mkdirSync(path.join(device, '1-2:1.0'), {recursive: true})
            writeFileSync(path.join(device, 'idVendor'), '04b8\n')
            writeFileSync(path.join(device, 'idProduct'), '0202\n')
            writeFileSync(path.join(device, 'serial'), 'X5FS012345\n')
            writeFileSync(path.join(device, 'manufacturer'), 'EPSON\n')
            writeFileSync(path.join(device, 'product'), 'TM-T88VI\n')
            writeFileSync(path.join(device, '1-2:1.0/ieee1284_id'), 'MFG:EPSON;CMD:ESC/POS;MDL:TM-T88VI;CLS:PRINTER;DES:EPSON TM-T88VI;\n')
            mkdirSync(path.join(root, 'sys/class/usbmisc/lp0'), {recursive: true})
            symlinkSync(path.join(device, '1-2:1.0'), path.join(root, 'sys/class/usbmisc/lp0/device'))
            assert.deepStrictEqual(await listLinuxUsbPrinters(root), [{
                path: '/dev/usb/lp0',
                deviceId: 'MFG:EPSON;CMD:ESC/POS;MDL:TM-T88VI;CLS:PRINTER;DES:EPSON TM-T88VI;',
                vendorId: 0x04B8,
                productId: 0x0202,
                serialNumber: 'X5FS012345',
                manufacturer: 'EPSON',
                product: 'TM-T88VI'
            }])
            assert.deepStrictEqual(await listLinuxUsbPrinters(path.join(root, 'nowhere')), [])
        } finally {
            rmSync(root, {recursive: true, force: true})
        }
        //The longest name of the table the model contains; the language of the command sets
        assert.strictEqual(modelOfDeviceId('MFG:EPSON;CMD:ESC/POS;MDL:TM-T88VI;CLS:PRINTER;')?.name, 'TM-T88VI')
        assert.strictEqual(modelOfDeviceId('MANUFACTURER:Zebra;COMMAND SET:ZPL;MODEL:Zebra HC100;')?.name, 'HC100')
        assert.strictEqual(modelOfDeviceId('MFG:Unknown;MDL:POS-80;'), undefined)
        assert.strictEqual(languageOfDeviceId('MFG:Zebra;CMD:ZPL,EPL;MDL:HC100;'), 'zpl')
        assert.strictEqual(languageOfDeviceId('MFG:TSC;CMD:TSPL2;MDL:TDP-225;'), 'tspl')
        assert.strictEqual(languageOfDeviceId('MFG:EPSON;CMD:ESC/POS;MDL:TM-T20III;'), 'escpos')
    })
})
