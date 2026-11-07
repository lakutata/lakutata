import {DTO, Provider} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {encode, type EncodeOptions, type MediaOptions, type PrintImage, render, type RenderOptions} from '@lakutata/thermal'
import {ThermalPrinterConnectionException} from '../exceptions/ThermalPrinterConnectionException.js'
import {ThermalPrinterException} from '../exceptions/ThermalPrinterException.js'
import {holdsConnection, openChannel} from '../lib/Channels.js'
import {CONNECTION} from '../lib/Schema.js'
import {type Channel, messageOf} from '../lib/Stream.js'
import type {PrintOptions, PrintResult, PrinterConnection, PrinterDefinition} from '../lib/Types.js'

/**
 * The failure of a print while its commands are sent: the one of the connection
 */
function sendFailure(error: unknown): Error {
    return error instanceof ThermalPrinterException ? error : new ThermalPrinterConnectionException(`The commands cannot be sent to the printer: ${messageOf(error)}`)
}

/**
 * A thermal printer: its connection, its media, its commands, and one queue of prints, sent one after the other in the
 * order of the calls. A serial, USB or Bluetooth printer holds its connection while the object lives (opened at the
 * first print, opened again after a failure); a network printer and a print queue are connected for each print. Opened
 * by the manager (`ThermalPrinterManager.open()`, from a definition saved as JSON), or declared in the configuration
 * and injected (one object for the name in its scope, as providers are); its destruction waits for its prints
 * (`drainTimeout`), then closes its connection.
 * @example
 * ```typescript
 * import type {ThermalPrinter, ThermalPrinterManager} from '@lakutata/thermal-printer'
 * async function receipt(manager: ThermalPrinterManager): Promise<void> {
 *     const printer: ThermalPrinter = await manager.open({connection: {type: 'usb', path: '/dev/usb/lp0'}, paper: 80, commands: {language: 'escpos', cut: 'partial'}})
 *     await printer.print('<h1>Order 42</h1>')
 * }
 * ```
 */
export class ThermalPrinter extends Provider {
    /**
     * How the printer is reached.
     */
    @Configurable(CONNECTION.required())
    public readonly connection: PrinterConnection

    /**
     * Its model (`printerModels()` lists them).
     */
    @Configurable(DTO.String().optional())
    public readonly model?: string

    /**
     * Its roll of paper: 58 or 80 (millimetres).
     */
    @Configurable(DTO.Any().optional())
    public readonly paper?: MediaOptions['paper']

    /**
     * Its labels: their size in millimetres.
     */
    @Configurable(DTO.Any().optional())
    public readonly label?: MediaOptions['label']

    /**
     * The width it prints, in millimetres.
     */
    @Configurable(DTO.Any().optional())
    public readonly width?: MediaOptions['width']

    /**
     * Its resolution in dots per inch.
     */
    @Configurable(DTO.Any().optional())
    public readonly dpi?: MediaOptions['dpi']

    /**
     * The turn of its renderings.
     */
    @Configurable(DTO.Any().optional())
    public readonly rotate?: MediaOptions['rotate']

    /**
     * Its pages.
     */
    @Configurable(DTO.Any().optional())
    public readonly page?: MediaOptions['page']

    /**
     * The directory its HTML reads its pictures and style sheets from.
     */
    @Configurable(DTO.String().optional())
    public readonly baseDir?: string

    /**
     * The language of its text, for the line breaking.
     */
    @Configurable(DTO.String().optional())
    public readonly textLanguage?: string

    /**
     * The options of its commands.
     */
    @Configurable(DTO.Object().unknown(true).optional())
    public readonly commands?: Omit<EncodeOptions, 'model'>

    /**
     * The most bytes a second sent to it.
     */
    @Configurable(DTO.Number().positive().optional())
    public readonly bytesPerSecond?: number

    /**
     * How long the connection may take to open, in milliseconds.
     */
    @Configurable(DTO.Number().positive().optional())
    public readonly connectTimeout?: number

    /**
     * How long the printer may take no data before a print fails, in milliseconds.
     */
    @Configurable(DTO.Number().min(0).optional())
    public readonly stallTimeout?: number

    /**
     * How long its destruction waits for its prints, in milliseconds.
     * @default 10000
     */
    @Configurable(DTO.Number().min(0).optional())
    protected readonly drainTimeout?: number

    /**
     * Told when the printer is destroyed (set by the manager).
     */
    @Configurable(DTO.Function().optional())
    protected readonly released?: () => void

    //The last print, which the next one waits for
    #queue: Promise<unknown> = Promise.resolve()

    readonly #prints: Set<Promise<unknown>> = new Set()

    //The connection held between the prints (serial, USB, Bluetooth)
    #channel: Channel | undefined

    #destroyed: boolean = false

    /**
     * Its media checked by the engine (an empty rendering): a printer with media the engine refuses is not created. A
     * printer without media (one given raw commands only) renders nothing.
     * @protected
     */
    protected async init(): Promise<void> {
        const media: unknown[] = [this.model, this.paper, this.label, this.width, this.dpi, this.rotate, this.page]
        if (media.some((value: unknown): boolean => value !== undefined)) await render('', this.#renderOptions())
    }

    /**
     * Wait for its prints (`drainTimeout`), then close its connection.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#destroyed = true
        let timer: NodeJS.Timeout | undefined
        await Promise.race([
            Promise.allSettled([...this.#prints]),
            new Promise<void>((resolve): void => {
                timer = setTimeout(resolve, this.drainTimeout ?? 10000)
            })
        ])
        clearTimeout(timer)
        const channel: Channel | undefined = this.#channel
        this.#channel = undefined
        await channel?.close(1000).catch((): void => undefined)
        this.released?.()
    }

    /**
     * Its definition, as JSON to save: `ThermalPrinterManager.open()` opens it again.
     */
    public get definition(): PrinterDefinition {
        const definition: Record<string, unknown> = {connection: this.connection}
        const keys: Array<keyof PrinterDefinition> = ['model', 'paper', 'label', 'width', 'dpi', 'rotate', 'page', 'baseDir', 'textLanguage', 'commands', 'bytesPerSecond', 'connectTimeout', 'stallTimeout']
        for (const key of keys) {
            if (this[key as keyof this] !== undefined) definition[key] = this[key as keyof this]
        }
        return JSON.parse(JSON.stringify(definition)) as PrinterDefinition
    }

    #renderOptions(signal?: AbortSignal): RenderOptions {
        return {
            model: this.model,
            paper: this.paper,
            label: this.label,
            width: this.width,
            dpi: this.dpi,
            rotate: this.rotate,
            page: this.page,
            baseDir: this.baseDir,
            language: this.textLanguage,
            signal: signal
        }
    }

    /**
     * The commands of a content: rendered and encoded, or raw commands as they are
     */
    async #commandsOf(content: string | PrintImage | Uint8Array, options: PrintOptions): Promise<{data: Buffer, pages: number}> {
        if (content instanceof Uint8Array) return {data: Buffer.from(content), pages: 0}
        //A rendering by its pages (not instanceof: the ES module and the CommonJS one of the engine are two classes)
        const image: PrintImage = typeof content === 'string' ? await render(content, this.#renderOptions(options.signal)) : content
        const encodeOptions: EncodeOptions = {...this.commands, ...options.commands, model: this.model}
        return {data: encode(image, encodeOptions), pages: image.pages.length}
    }

    /**
     * Send commands: on the held connection (opened when it is not, given up when it fails), or on a connection of
     * their own
     */
    async #send(data: Buffer): Promise<void> {
        const stallTimeout: number = this.stallTimeout ?? 10000
        const timeout: number = this.connectTimeout ?? 10000
        if (holdsConnection(this.connection)) {
            if (!this.#channel || this.#channel.broken) {
                await this.#channel?.close(1000).catch((): void => undefined)
                this.#channel = await openChannel(this.connection, timeout, stallTimeout)
            }
            const channel: Channel = this.#channel
            try {
                await channel.write(data, this.bytesPerSecond, stallTimeout)
                await channel.settle(stallTimeout)
            } catch (error) {
                this.#channel = undefined
                await channel.close(1000).catch((): void => undefined)
                throw sendFailure(error)
            }
            return
        }
        const channel: Channel = await openChannel(this.connection, timeout, stallTimeout)
        try {
            await channel.write(data, this.bytesPerSecond, stallTimeout)
        } catch (error) {
            //The write failed (the printer dropped the connection, lp ended early): its error, not the one of the closing
            await channel.close(1000).catch((): void => undefined)
            throw sendFailure(error)
        }
        try {
            await channel.close(stallTimeout)
        } catch (error) {
            throw sendFailure(error)
        }
    }

    /**
     * Print: HTML rendered at its media and encoded as its commands, a rendering encoded, or raw commands sent as they
     * are. Its prints are rendered and sent one after the other, in the order of the calls.
     * @param content HTML, a `PrintImage` of `render()`, or raw commands (a `Buffer`).
     * @param options The options of the commands for this print, a cancellation.
     * @returns The pages and the bytes sent, once the printer took them.
     * @throws {ThermalPrinterConnectionException} The printer cannot be reached, or took no data for its stall timeout.
     * @throws {ThermalPrinterException} The printer is closed, or its connection needs a package not installed.
     * @example
     * ```typescript
     * import type {ThermalPrinter} from '@lakutata/thermal-printer'
     * async function receipt(printer: ThermalPrinter): Promise<void> {
     *     await printer.print('<h1>Order 42</h1>', {commands: {cut: 'partial'}})
     * }
     * ```
     */
    public async print(content: string | PrintImage | Uint8Array, options: PrintOptions = {}): Promise<PrintResult> {
        if (this.#destroyed) throw new ThermalPrinterException('The printer is closed')
        //Its place in the queue taken at once (the prints go out in the order of the calls), rendered when its turn comes
        const job: Promise<PrintResult> = this.#queue.catch((): void => undefined).then(async (): Promise<PrintResult> => {
            if (options.signal?.aborted) throw new ThermalPrinterException('The print is cancelled')
            const {data, pages} = await this.#commandsOf(content, options)
            await this.#send(data)
            return {pages, bytes: data.length}
        })
        this.#queue = job
        this.#prints.add(job)
        try {
            return await job
        } finally {
            this.#prints.delete(job)
        }
    }

    /**
     * The preview of a print: the HTML rendered at its media, the same dots it prints.
     * @param html The HTML.
     * @param options A cancellation.
     * @returns The rendering (`toPNG()` for a picture).
     * @example
     * ```typescript
     * import type {ThermalPrinter} from '@lakutata/thermal-printer'
     * async function preview(printer: ThermalPrinter): Promise<Buffer> {
     *     return (await printer.preview('<h1>Order 42</h1>')).toPNG()
     * }
     * ```
     */
    public async preview(html: string, options: {signal?: AbortSignal} = {}): Promise<PrintImage> {
        return await render(html, this.#renderOptions(options.signal))
    }

    /**
     * The commands a print would send, not sent.
     * @param content HTML or a `PrintImage`.
     * @param options The options of the commands for this print.
     * @returns The commands.
     * @example
     * ```typescript
     * import type {ThermalPrinter} from '@lakutata/thermal-printer'
     * async function bytes(printer: ThermalPrinter): Promise<Buffer> {
     *     return await printer.commandsOf('<h1>Order 42</h1>')
     * }
     * ```
     */
    public async commandsOf(content: string | PrintImage, options: PrintOptions = {}): Promise<Buffer> {
        return (await this.#commandsOf(content, options)).data
    }
}
