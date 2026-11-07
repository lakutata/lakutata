import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Autoload, Configurable, Singleton} from '@lakutata/core/decorator/di'
import type {PrintImage} from '@lakutata/thermal'
import {ThermalPrinterException} from '../exceptions/ThermalPrinterException.js'
import {queueCandidates, serialCandidates, usbCandidates} from '../lib/Discovery.js'
import {keyOf} from '../lib/Identity.js'
import {DEFINITION, validatePrinterDefinition} from '../lib/Schema.js'
import {resolveUsb, type UsbPrinterInfo} from '../lib/transports/Usb.js'
import type {DiscoverOptions, PrintOptions, PrintResult, PrinterCandidate, PrinterConnection, PrinterDefinition} from '../lib/Types.js'
import {ThermalPrinter} from '../providers/ThermalPrinter.js'

/**
 * The options of the manager in the configuration (see {@link buildThermalPrinterManagerOptions}).
 */
export interface ThermalPrinterManagerConfig {
    /**
     * Printers by their names, opened when they are first used (`get()`, `print()`): a printer away when the
     * application starts does not fail it.
     */
    printers?: Record<string, PrinterDefinition>

    /**
     * How long the closing of a printer waits for its prints, in milliseconds.
     * @default 10000
     */
    drainTimeout?: number
}

/**
 * The manager of the thermal printers: it finds the devices (`discover()`), opens printers from their definitions
 * (`open()`, one printer object for each device, its definition saved as JSON by the application and opened again
 * later), gives them by name (`get()`, the printers of its configuration opened when first used), and closes them
 * (`close()`, all of them with the manager). A print can go through it in one call (`print()`).
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import type {PrinterDefinition, ThermalPrinterManager} from '@lakutata/thermal-printer'
 * class Counter extends Component {
 *     @Inject('printers')
 *     protected readonly printers: ThermalPrinterManager
 *     public async setUp(): Promise<PrinterDefinition | undefined> {
 *         const [found] = (await this.printers.discover()).filter((candidate) => candidate.printer)
 *         if (!found) return undefined
 *         const printer = await this.printers.open({connection: found.connection, model: found.model, paper: 80})
 *         return printer.definition
 *     }
 * }
 * ```
 */
@Autoload()
@Singleton()
export class ThermalPrinterManager extends Component {

    /**
     * The printers of the configuration, by their names.
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DEFINITION).optional())
    protected readonly printers?: Record<string, PrinterDefinition>

    /**
     * How long the closing of a printer waits for its prints, in milliseconds.
     */
    @Configurable(DTO.Number().min(0).optional())
    protected readonly drainTimeout?: number

    //The printers open (or opening), by the key of their device
    readonly #byKey: Map<string, Promise<ThermalPrinter>> = new Map()

    readonly #opened: Map<string, ThermalPrinter> = new Map()

    //The names given to the printers open, to the key of their device
    readonly #names: Map<string, string> = new Map()

    #destroyed: boolean = false

    /**
     * Close its printers (each waits for its prints).
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#destroyed = true
        const printers: ThermalPrinter[] = await Promise.all([...this.#byKey.values()].map((opening: Promise<ThermalPrinter>): Promise<ThermalPrinter | undefined> => opening.catch((): undefined => undefined))).then((list): ThermalPrinter[] => list.filter((printer): printer is ThermalPrinter => !!printer))
        await Promise.allSettled(printers.map((printer: ThermalPrinter): Promise<void> => printer.dispose()))
    }

    /**
     * Find the printers and the ports printers may be on: USB printers (with the model their IEEE 1284 id names), the
     * print queues of the system, the serial ports and the ports of paired Bluetooth devices (with `@lakutata/serial`
     * installed). Network printers are not found: their address is entered.
     * @param options What it looks for.
     * @returns The candidates, each with a connection ready to be opened and saved.
     * @example
     * ```typescript
     * const candidates = await manager.discover()
     * for (const candidate of candidates) console.log(candidate.kind, candidate.name, candidate.model)
     * ```
     */
    public async discover(options: DiscoverOptions = {}): Promise<PrinterCandidate[]> {
        const settled = await Promise.allSettled([
            options.usb === false ? [] : usbCandidates(),
            options.queues === false ? [] : queueCandidates(),
            options.serial === false ? [] : serialCandidates()
        ])
        //An addon not built (its install script skipped) is told; another source failing leaves the others
        for (const result of settled) {
            if (result.status === 'rejected' && /is not built/.test(String((result.reason as Error)?.message))) throw result.reason
        }
        return settled.flatMap((result): PrinterCandidate[] => result.status === 'fulfilled' ? result.value : [])
    }

    /**
     * The key of a connection's device: a USB printer named by its ids keyed by its path where it has one
     */
    async #keyOf(connection: PrinterConnection): Promise<string> {
        if (connection.type === 'usb' && !connection.path && process.platform !== 'darwin') {
            const found: UsbPrinterInfo | undefined = await resolveUsb(connection).catch((): undefined => undefined)
            if (found?.path) return keyOf({type: 'usb', path: found.path})
        }
        return keyOf(connection)
    }

    /**
     * Open a printer from its definition (one saved as JSON included): a printer object for its device, created once;
     * the same device opened again gives the same object (and its definition).
     * @param definition Its connection, its media, the options of its commands.
     * @param name A name to get it by later (`get()`).
     * @returns The printer.
     * @throws {ThermalPrinterOptionException} The definition is not one.
     * @throws {ThermalOptionException} The engine refuses its media.
     * @example
     * ```typescript
     * const printer = await manager.open({connection: {type: 'serial', path: 'COM3', baudRate: 115200}, paper: 58, commands: {language: 'escpos'}}, 'kitchen')
     * await printer.print('<h2>Table 7</h2>')
     * ```
     */
    public async open(definition: PrinterDefinition, name?: string): Promise<ThermalPrinter> {
        if (this.#destroyed) throw new ThermalPrinterException('The manager is destroyed')
        validatePrinterDefinition(definition)
        const key: string = await this.#keyOf(definition.connection)
        let opening: Promise<ThermalPrinter> | undefined = this.#byKey.get(key)
        if (!opening) {
            opening = this.buildObject(ThermalPrinter, {
                ...definition,
                drainTimeout: this.drainTimeout,
                released: (): void => this.#forget(key)
            }).then((printer: ThermalPrinter): ThermalPrinter => {
                this.#opened.set(key, printer)
                return printer
            })
            this.#byKey.set(key, opening)
            opening.catch((): void => {
                this.#forget(key)
            })
        }
        if (name !== undefined) this.#names.set(name, key)
        return await opening
    }

    #forget(key: string): void {
        this.#byKey.delete(key)
        this.#opened.delete(key)
        for (const [name, named] of this.#names) {
            if (named === key) this.#names.delete(name)
        }
    }

    /**
     * A printer by its name: one opened with that name, or one of the configuration (opened now when it is not).
     * @param name The name.
     * @returns The printer.
     * @throws {ThermalPrinterException} No printer has that name.
     * @example
     * ```typescript
     * const front = await manager.get('front')
     * ```
     */
    public async get(name: string): Promise<ThermalPrinter> {
        const key: string | undefined = this.#names.get(name)
        const opening: Promise<ThermalPrinter> | undefined = key === undefined ? undefined : this.#byKey.get(key)
        if (opening) return await opening
        const definition: PrinterDefinition | undefined = this.printers?.[name]
        if (!definition) throw new ThermalPrinterException(`No printer is named ${name}`)
        return await this.open(definition, name)
    }

    /**
     * The names of its printers: the ones of the configuration and the ones given to `open()`.
     * @returns The names.
     * @example
     * ```typescript
     * console.log(manager.names())
     * ```
     */
    public names(): string[] {
        return [...new Set([...Object.keys(this.printers ?? {}), ...this.#names.keys()])]
    }

    /**
     * The printers open now.
     * @returns The printers.
     * @example
     * ```typescript
     * for (const printer of manager.openPrinters()) console.log(printer.definition)
     * ```
     */
    public openPrinters(): ThermalPrinter[] {
        return [...this.#opened.values()]
    }

    /**
     * Close a printer: its prints sent (for `drainTimeout` at most), its connection closed. A name of the
     * configuration opens again at its next use.
     * @param printer The printer, or its name.
     * @returns Once it is closed.
     * @example
     * ```typescript
     * await manager.close('kitchen')
     * ```
     */
    public async close(printer: string | ThermalPrinter): Promise<void> {
        let instance: ThermalPrinter | undefined
        if (typeof printer === 'string') {
            const key: string | undefined = this.#names.get(printer)
            instance = key === undefined ? undefined : await this.#byKey.get(key)?.catch((): undefined => undefined)
        } else {
            instance = printer
        }
        await instance?.dispose()
    }

    /**
     * The printer of a name or of a definition
     */
    async #printerOf(printer: string | PrinterDefinition): Promise<ThermalPrinter> {
        return typeof printer === 'string' ? await this.get(printer) : await this.open(printer)
    }

    /**
     * Print on a printer, by its name or its definition, in one call (`get()` or `open()`, then its `print()`).
     * @param printer Its name, or its definition.
     * @param content HTML, a `PrintImage` of `render()`, or raw commands (a `Buffer`).
     * @param options The options of the commands for this print, a cancellation.
     * @returns The pages and the bytes sent.
     * @throws {ThermalPrinterException} No printer has that name, or its connection needs a package not installed.
     * @throws {ThermalPrinterConnectionException} The printer cannot be reached, or took no data for its stall timeout.
     * @example
     * ```typescript
     * await manager.print('front', '<h1>Order 42</h1>', {commands: {cut: 'partial'}})
     * ```
     */
    public async print(printer: string | PrinterDefinition, content: string | PrintImage | Uint8Array, options: PrintOptions = {}): Promise<PrintResult> {
        return await (await this.#printerOf(printer)).print(content, options)
    }

    /**
     * The preview of a print on a printer, by its name or its definition.
     * @param printer Its name, or its definition.
     * @param html The HTML.
     * @param options A cancellation.
     * @returns The rendering (`toPNG()` for a picture).
     * @example
     * ```typescript
     * const png: Buffer = (await manager.preview('front', '<h1>Order 42</h1>')).toPNG()
     * ```
     */
    public async preview(printer: string | PrinterDefinition, html: string, options: {signal?: AbortSignal} = {}): Promise<PrintImage> {
        return await (await this.#printerOf(printer)).preview(html, options)
    }
}

/**
 * The options of a thermal printer manager in the configuration of the application: its printers by name (opened when
 * first used), the wait of their closing. The manager is injected by the name it is registered under.
 * @param options Its printers, the wait of their closing.
 * @returns The options of the component.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildThermalPrinterManagerOptions} from '@lakutata/thermal-printer'
 * Application.run(() => ({
 *     id: 'shop',
 *     name: 'Shop',
 *     components: {
 *         printers: buildThermalPrinterManagerOptions({
 *             printers: {
 *                 front: {connection: {type: 'network', host: '192.168.1.50'}, model: 'TM-T88VI', commands: {cut: 'partial'}}
 *             }
 *         })
 *     }
 * }))
 * ```
 */
export function buildThermalPrinterManagerOptions(options: ThermalPrinterManagerConfig = {}): ComponentOptions<ThermalPrinterManagerConfig> {
    return {class: ThermalPrinterManager, ...options}
}
