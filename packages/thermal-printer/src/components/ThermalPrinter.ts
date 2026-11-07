import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Autoload, Configurable, Singleton} from '@lakutata/core/decorator/di'
import {encode, type EncodeOptions, type PrintImage, render, type RenderOptions} from '@lakutata/thermal'
import {ThermalPrinterConnectionException} from '../exceptions/ThermalPrinterConnectionException.js'
import {ThermalPrinterException} from '../exceptions/ThermalPrinterException.js'
import {type Channel, openChannel} from '../lib/Connections.js'
import type {PrinterDefinition, PrintOptions, PrintResult} from '../lib/Types.js'

/**
 * The options of the component in the configuration (see {@link buildThermalPrinterOptions}).
 */
export interface ThermalPrinterConfig {
    /**
     * The printers, by their names: how each is reached, its media, the options of its commands.
     */
    printers?: Record<string, PrinterDefinition>

    /**
     * How long the destruction of the component waits for the prints running, in milliseconds.
     * @default 10000
     */
    drainTimeout?: number
}

const CONNECTION = DTO.Object({
    type: DTO.String().valid('network', 'queue', 'serial', 'usb', 'bluetooth').required()
}).unknown(true)

const PRINTER = DTO.Object({
    connection: CONNECTION.required(),
    bytesPerSecond: DTO.Number().positive().optional(),
    connectTimeout: DTO.Number().positive().optional(),
    stallTimeout: DTO.Number().min(0).optional()
}).unknown(true)

/**
 * Thermal printers: renders receipts, labels and wristbands written in HTML (by `@lakutata/thermal`), encodes them as
 * the commands of each printer (ESC/POS, TSPL or ZPL), and sends them by the network, the system's print queue, a
 * serial port, USB or Bluetooth. Each printer has one queue: its prints are sent one after the other, in their order.
 * The printers are declared in its options ({@link buildThermalPrinterOptions}) and named by the calls, or given by a
 * call. Its destruction waits for the prints running (`drainTimeout`).
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import type {ThermalPrinter} from '@lakutata/thermal-printer'
 * class Orders extends Component {
 *     @Inject('printers')
 *     protected readonly printers: ThermalPrinter
 *     public async receipt(id: string): Promise<void> {
 *         await this.printers.print('front', `<h1>Order ${id}</h1>`, {commands: {cut: 'partial'}})
 *     }
 * }
 * ```
 */
@Autoload()
@Singleton()
export class ThermalPrinter extends Component {

    /**
     * The printers, by their names.
     */
    @Configurable(DTO.Object().pattern(DTO.String(), PRINTER).optional())
    protected readonly printers?: Record<string, PrinterDefinition>

    /**
     * How long the destruction waits for the prints running, in milliseconds.
     */
    @Configurable(DTO.Number().min(0).optional())
    protected readonly drainTimeout?: number

    //The last print of each printer, which the next one waits for: one queue a printer
    readonly #queues: Map<string, Promise<unknown>> = new Map()

    readonly #prints: Set<Promise<unknown>> = new Set()

    #destroyed: boolean = false

    /**
     * Wait for the prints running, then refuse the new ones.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#destroyed = true
        const timeout: number = this.drainTimeout ?? 10000
        let timer: NodeJS.Timeout | undefined
        await Promise.race([
            Promise.allSettled([...this.#prints]),
            new Promise<void>((resolve): void => {
                timer = setTimeout(resolve, timeout)
            })
        ])
        clearTimeout(timer)
    }

    /**
     * The names of the printers of its options.
     * @returns The names.
     * @example
     * ```typescript
     * console.log(printers.printerNames())
     * ```
     */
    public printerNames(): string[] {
        return Object.keys(this.printers ?? {})
    }

    /**
     * The definition of a printer: one of its options by its name, or the one given
     * @param printer
     */
    #definitionOf(printer: string | PrinterDefinition): PrinterDefinition {
        if (typeof printer !== 'string') {
            if (!printer || typeof printer !== 'object' || !printer.connection) throw new ThermalPrinterException('A printer is named, or given with its connection')
            return printer
        }
        const definition: PrinterDefinition | undefined = this.printers?.[printer]
        if (!definition) throw new ThermalPrinterException(`No printer is named ${printer}`)
        return definition
    }

    /**
     * The options of the rendering of a printer
     * @param definition
     * @param signal
     */
    #renderOptionsOf(definition: PrinterDefinition, signal?: AbortSignal): RenderOptions {
        return {
            model: definition.model,
            paper: definition.paper,
            label: definition.label,
            width: definition.width,
            dpi: definition.dpi,
            rotate: definition.rotate,
            page: definition.page,
            baseDir: definition.baseDir,
            language: definition.textLanguage,
            signal: signal
        }
    }

    /**
     * The commands of a content for a printer: rendered and encoded, or raw commands as they are
     * @param definition
     * @param content
     * @param options
     */
    async #commandsOf(definition: PrinterDefinition, content: string | PrintImage | Uint8Array, options: PrintOptions): Promise<{data: Buffer, pages: number}> {
        if (content instanceof Uint8Array) return {data: Buffer.from(content), pages: 0}
        //A rendering by its pages (not instanceof: the ES module and the CommonJS one of the engine are two classes)
        const image: PrintImage = typeof content === 'string' ? await render(content, this.#renderOptionsOf(definition, options.signal)) : content
        const encodeOptions: EncodeOptions = {...definition.commands, ...options.commands, model: definition.model}
        return {data: encode(image, encodeOptions), pages: image.pages.length}
    }

    /**
     * The key of the queue of a printer: its name, or its connection
     * @param printer
     */
    #queueOf(printer: string | PrinterDefinition): string {
        return typeof printer === 'string' ? `name:${printer}` : `connection:${JSON.stringify(printer.connection)}`
    }

    /**
     * Print on a printer: HTML rendered at its media and encoded as its commands, a rendering encoded, or raw commands
     * sent as they are. The prints of a printer are rendered and sent one after the other, in the order of the calls;
     * each opens the connection, sends its commands and closes it.
     * @param printer The name of a printer of the options, or a printer (its connection, its media, its commands).
     * @param content HTML, a `PrintImage` of `render()`, or raw commands (a `Buffer`).
     * @param options The options of the commands for this print, a cancellation.
     * @returns The pages and the bytes sent.
     * @throws {ThermalPrinterException} No printer of that name, or its connection needs a package not installed.
     * @throws {ThermalPrinterConnectionException} The printer cannot be reached or the commands cannot be sent.
     * @example
     * ```typescript
     * await printers.print('front', '<h1>Order 42</h1>', {commands: {cut: 'partial'}})
     * await printers.print({connection: {type: 'network', host: '192.168.1.50'}, paper: 80, commands: {language: 'escpos'}}, '<p>Hello</p>')
     * ```
     */
    public async print(printer: string | PrinterDefinition, content: string | PrintImage | Uint8Array, options: PrintOptions = {}): Promise<PrintResult> {
        if (this.#destroyed) throw new ThermalPrinterException('The component is destroyed')
        const definition: PrinterDefinition = this.#definitionOf(printer)
        const key: string = this.#queueOf(printer)
        const previous: Promise<unknown> = this.#queues.get(key) ?? Promise.resolve()
        //Its place in the queue taken at once (the prints go out in the order of the calls), rendered when its turn comes
        const job: Promise<PrintResult> = previous.catch((): void => undefined).then(async (): Promise<PrintResult> => {
            if (options.signal?.aborted) throw new ThermalPrinterException('The print is cancelled')
            const {data, pages} = await this.#commandsOf(definition, content, options)
            const stallTimeout: number = definition.stallTimeout ?? 10000
            const channel: Channel = await openChannel(definition.connection, definition.connectTimeout ?? 10000, stallTimeout)
            try {
                await channel.write(data, definition.bytesPerSecond, stallTimeout)
            } catch (error) {
                //The write failed (the printer dropped the connection, lp ended early): its error, not the one of the closing
                await channel.close(1000).catch((): void => undefined)
                throw error instanceof ThermalPrinterException ? error : new ThermalPrinterConnectionException(`The commands cannot be sent to the printer: ${error instanceof Error ? error.message : String(error)}`)
            }
            try {
                await channel.close(stallTimeout)
            } catch (error) {
                throw error instanceof ThermalPrinterException ? error : new ThermalPrinterConnectionException(`The commands cannot be sent to the printer: ${error instanceof Error ? error.message : String(error)}`)
            }
            return {pages, bytes: data.length}
        })
        this.#queues.set(key, job)
        this.#prints.add(job)
        try {
            return await job
        } finally {
            this.#prints.delete(job)
            if (this.#queues.get(key) === job) this.#queues.delete(key)
        }
    }

    /**
     * The preview of a print: the HTML rendered at the printer's media, the same dots it prints.
     * @param printer The name of a printer of the options, or a printer.
     * @param html The HTML.
     * @param options A cancellation.
     * @returns The rendering (`toPNG()` for a picture).
     * @example
     * ```typescript
     * const image = await printers.preview('front', '<h1>Order 42</h1>')
     * const png: Buffer = image.toPNG()
     * ```
     */
    public async preview(printer: string | PrinterDefinition, html: string, options: {signal?: AbortSignal} = {}): Promise<PrintImage> {
        return await render(html, this.#renderOptionsOf(this.#definitionOf(printer), options.signal))
    }

    /**
     * The commands a print would send, not sent.
     * @param printer The name of a printer of the options, or a printer.
     * @param content HTML or a `PrintImage`.
     * @param options The options of the commands for this print.
     * @returns The commands.
     * @example
     * ```typescript
     * const bytes: Buffer = await printers.commands('front', '<h1>Order 42</h1>')
     * ```
     */
    public async commands(printer: string | PrinterDefinition, content: string | PrintImage, options: PrintOptions = {}): Promise<Buffer> {
        return (await this.#commandsOf(this.#definitionOf(printer), content, options)).data
    }
}

/**
 * The options of a thermal printer component in the configuration of the application: its printers by name. The
 * component is injected by the name it is registered under.
 * @param options Its printers, the wait of its destruction.
 * @returns The options of the component.
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import {buildThermalPrinterOptions, type ThermalPrinter} from '@lakutata/thermal-printer'
 * class Counter extends Component {
 *     @Inject('printers')
 *     protected readonly printers: ThermalPrinter
 * }
 * Application.run(() => ({
 *     id: 'shop',
 *     name: 'Shop',
 *     components: {
 *         printers: buildThermalPrinterOptions({
 *             printers: {
 *                 front: {connection: {type: 'network', host: '192.168.1.50'}, model: 'TM-T88VI', commands: {cut: 'partial'}},
 *                 ward: {connection: {type: 'queue', name: 'HC100'}, model: 'HC100', label: {width: 25, height: 250}, commands: {sensor: 'mark'}}
 *             }
 *         }),
 *         counter: {class: Counter}
 *     }
 * }))
 * ```
 */
export function buildThermalPrinterOptions(options: ThermalPrinterConfig = {}): ComponentOptions<ThermalPrinterConfig> {
    return {class: ThermalPrinter, ...options}
}
