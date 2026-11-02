import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Autoload, Configurable, Singleton} from '@lakutata/core/decorator/di'
import {Accept} from '@lakutata/core/decorator/dto'
import {BarcodeCancelledException} from '../exceptions/BarcodeCancelledException.js'
import {BarcodeTimeoutException} from '../exceptions/BarcodeTimeoutException.js'
import {native, type NativeResult, runOperation} from '../lib/Native.js'
import {BARCODE_FORMATS, type BarcodeFormat, type BarcodeResult, type GenerateOptions, type RawImage, type ReadOptions} from '../lib/Types.js'

/**
 * The options of the component in the configuration (see {@link buildBarcodeOptions}).
 */
export interface BarcodeConfig {
    /**
     * The options every `generate()` and `read()` of the component takes, before the ones of the call.
     */
    defaults?: {
        generate?: Omit<GenerateOptions, keyof OperationKeys>
        read?: Omit<ReadOptions, keyof OperationKeys>
    }
    /**
     * The time limit of an operation, in milliseconds, unless the call gives one; 0 for none.
     * @default 0
     */
    timeout?: number
    /**
     * The operations of the component running at once; the others wait. All the threads of the addon by default
     * (`LAKUTATA_BARCODE_THREADS`, else the processors less one).
     */
    concurrency?: number
    /**
     * How long the destruction of the component waits for its operations running, in milliseconds.
     * @default 10000
     */
    drainTimeout?: number
}

type OperationKeys = {signal: unknown, timeout: unknown}

const FORMAT = DTO.String().valid(...BARCODE_FORMATS)
const COLOR = DTO.String().pattern(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/)
const BYTES = DTO.InstanceOf(Uint8Array)

const GENERATE_KEYS = {
    output: DTO.String().valid('png', 'svg', 'raw').optional(),
    scale: DTO.Number().integer().min(1).max(100).optional(),
    height: DTO.Number().positive().max(1000).optional(),
    quietZone: DTO.Alternatives(DTO.Boolean(), DTO.Number().integer().min(0).max(100)).optional(),
    showText: DTO.Boolean().optional(),
    foreground: COLOR.optional(),
    background: COLOR.optional(),
    rotate: DTO.Number().valid(0, 90, 180, 270).optional(),
    errorCorrection: DTO.Alternatives(DTO.String().valid('L', 'M', 'Q', 'H'), DTO.Number().integer().min(0).max(8)).optional(),
    version: DTO.Number().integer().min(1).optional(),
    gs1: DTO.Boolean().optional(),
    eci: DTO.Number().integer().min(0).max(999999).optional(),
    addOn: DTO.String().pattern(/^(\d{2}|\d{5})$/).optional()
}

const READ_KEYS = {
    formats: DTO.Array(FORMAT).optional(),
    tryHarder: DTO.Boolean().optional(),
    tryRotate: DTO.Boolean().optional(),
    tryInvert: DTO.Boolean().optional(),
    tryDownscale: DTO.Boolean().optional(),
    pure: DTO.Boolean().optional(),
    maxSymbols: DTO.Number().integer().min(1).max(255).optional(),
    addOn: DTO.String().valid('ignore', 'read', 'require').optional()
}

const OPERATION_KEYS = {
    signal: DTO.InstanceOf(AbortSignal).optional(),
    timeout: DTO.Number().min(0).optional()
}

const RAW_IMAGE = DTO.Object({
    data: BYTES.required(),
    width: DTO.Number().integer().min(1).required(),
    height: DTO.Number().integer().min(1).required(),
    channels: DTO.Number().valid(1, 3, 4).required()
})

/**
 * Barcodes and QR codes: generates them (PNG, SVG or pixels) and reads them from images, in the threads of the addon
 * (zint generates, zxing-cpp reads). Every format it generates, it reads back. Inject it (`@Inject(Barcode)`): it needs
 * no registration; register it with {@link buildBarcodeOptions} to give its options, or several of them under other
 * names, each with its own options. Its destruction waits for its operations running (`drainTimeout`).
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import {Barcode} from '@lakutata/barcode'
 * class Orders extends Component {
 *     @Inject(Barcode)
 *     protected readonly barcode: Barcode
 *     public async label(id: string): Promise<Buffer> {
 *         return await this.barcode.generate('QRCode', `https://example.com/orders/${id}`)
 *     }
 *     public async scan(photo: Buffer): Promise<string[]> {
 *         return (await this.barcode.read(photo, {formats: ['QRCode']})).map((result) => result.text)
 *     }
 * }
 * ```
 */
@Autoload()
@Singleton()
export class Barcode extends Component {

    /**
     * The options every `generate()` and `read()` of the component takes, before the ones of the call.
     */
    @Configurable(DTO.Object({generate: DTO.Object(GENERATE_KEYS).optional(), read: DTO.Object(READ_KEYS).optional()}).optional())
    protected readonly defaults?: BarcodeConfig['defaults']

    /**
     * The time limit of an operation, in milliseconds; 0 for none.
     */
    @Configurable(DTO.Number().min(0).optional())
    protected readonly timeout?: number

    /**
     * The operations of the component running at once.
     */
    @Configurable(DTO.Number().integer().min(1).optional())
    protected readonly concurrency?: number

    /**
     * How long the destruction waits for the operations running, in milliseconds.
     */
    @Configurable(DTO.Number().min(0).optional())
    protected readonly drainTimeout?: number

    #running: number = 0

    //The operations waiting for their turn (concurrency): resolved when they may run, rejected by their signal, their
    //time limit or the destruction of the component
    readonly #waiting: {run: () => void, fail: (error: Error) => void}[] = []

    readonly #operations: Set<Promise<unknown>> = new Set()

    #destroyed: boolean = false

    /**
     * Wait for the operations running, then refuse the new ones.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#destroyed = true
        for (const waiting of this.#waiting.splice(0)) waiting.fail(new BarcodeCancelledException('The component is destroyed'))
        const timeout: number = this.drainTimeout ?? 10000
        let timer: NodeJS.Timeout | undefined
        await Promise.race([
            Promise.allSettled([...this.#operations]),
            new Promise<void>((resolve): void => {
                timer = setTimeout(resolve, timeout)
            })
        ])
        clearTimeout(timer)
    }

    /**
     * Generate a barcode.
     * @param format Its format.
     * @param content Its content: text (UTF-8), or bytes.
     * @param options The output (`'png'` by default), the size, the colors and the options of the symbol.
     * @returns The PNG, the SVG or the pixels.
     * @throws {BarcodeContentException} The content cannot be encoded in the format.
     * @throws {BarcodeOptionException} An option of the symbol the format does not take.
     * @example
     * ```typescript
     * const png: Buffer = await barcode.generate('QRCode', 'https://example.com', {scale: 8, errorCorrection: 'M'})
     * const svg: string = await barcode.generate('EAN13', '590123412345', {output: 'svg'})
     * const pixels: RawImage = await barcode.generate('Code128', 'LKT-1001', {output: 'raw'})
     * ```
     */
    public generate(format: BarcodeFormat, content: string | Uint8Array, options?: GenerateOptions & {output?: 'png'}): Promise<Buffer>
    public generate(format: BarcodeFormat, content: string | Uint8Array, options: GenerateOptions & {output: 'svg'}): Promise<string>
    public generate(format: BarcodeFormat, content: string | Uint8Array, options: GenerateOptions & {output: 'raw'}): Promise<RawImage>
    public generate(format: BarcodeFormat, content: string | Uint8Array, options: GenerateOptions): Promise<Buffer | string | RawImage>
    @Accept(FORMAT.required(), DTO.Alternatives(DTO.String().allow(''), BYTES).required(), DTO.Object({...GENERATE_KEYS, ...OPERATION_KEYS}).optional())
    public async generate(format: BarcodeFormat, content: string | Uint8Array, options: GenerateOptions = {}): Promise<Buffer | string | RawImage> {
        const {signal, timeout, ...given} = {...this.defaults?.generate, ...options}
        const binary: boolean = typeof content !== 'string'
        const bytes: Uint8Array = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
        const settings: Record<string, unknown> = {
            ...given,
            foreground: given.foreground?.slice(1),
            background: given.background?.slice(1)
        }
        const generated = await this.#run((token: unknown) => native.generate(format, bytes, binary, settings, token), signal, timeout)
        if (generated.type === 'svg') return generated.data.toString('utf8')
        if (generated.type === 'raw') return {data: generated.data, width: generated.width, height: generated.height, channels: generated.channels as RawImage['channels']}
        return generated.data
    }

    /**
     * Read the barcodes of an image.
     * @param image An image (PNG, JPEG, GIF, BMP, WebP or TGA), or its pixels.
     * @param options The formats looked for, the efforts of the reading.
     * @returns The codes read, an empty array when there is none.
     * @throws {BarcodeImageException} The image cannot be decoded, or is too large.
     * @example
     * ```typescript
     * for (const result of await barcode.read(photo, {formats: ['QRCode', 'EAN13']})) console.log(result.format, result.text)
     * ```
     */
    @Accept(DTO.Alternatives(BYTES, RAW_IMAGE).required(), DTO.Object({...READ_KEYS, ...OPERATION_KEYS}).optional())
    public async read(image: Uint8Array | RawImage, options: ReadOptions = {}): Promise<BarcodeResult[]> {
        const {signal, timeout, ...given} = {...this.defaults?.read, ...options}
        const raw: RawImage | undefined = image instanceof Uint8Array ? undefined : image
        const data: Uint8Array = raw ? raw.data : image as Uint8Array
        const results: NativeResult[] = await this.#run((token: unknown) => native.read(data, raw ? {width: raw.width, height: raw.height, channels: raw.channels} : null, given, token), signal, timeout)
        return results.map((result: NativeResult): BarcodeResult => ({
            format: result.format,
            text: result.text,
            bytes: result.bytes,
            position: {
                topLeft: {x: result.position[0], y: result.position[1]},
                topRight: {x: result.position[2], y: result.position[3]},
                bottomRight: {x: result.position[4], y: result.position[5]},
                bottomLeft: {x: result.position[6], y: result.position[7]}
            },
            orientation: result.orientation,
            ...result.errorCorrectionLevel ? {errorCorrectionLevel: result.errorCorrectionLevel} : {},
            ...result.version ? {version: result.version} : {},
            symbologyIdentifier: result.symbologyIdentifier,
            ...result.addOn ? {addOn: result.addOn} : {},
            gs1: result.gs1,
            mirrored: result.mirrored,
            inverted: result.inverted,
            ...result.sequenceSize > 0 ? {structuredAppend: {index: result.sequenceIndex, count: result.sequenceSize, id: result.sequenceId}} : {}
        }))
    }

    /**
     * Run an operation in its turn (concurrency), with its signal and its time limit, which count from the call: the
     * wait for its turn included
     * @param start
     * @param signal
     * @param timeout
     */
    async #run<T>(start: (token: unknown) => Promise<T>, signal: AbortSignal | undefined, timeout: number | undefined): Promise<T> {
        if (this.#destroyed) throw new BarcodeCancelledException('The component is destroyed')
        const limit: number = timeout ?? this.timeout ?? 0
        const deadline: number = limit > 0 ? Date.now() + limit : 0
        await this.#turn(signal, deadline, limit)
        this.#running++
        const operation: Promise<T> = runOperation(start, signal, deadline ? Math.max(1, deadline - Date.now()) : 0)
        this.#operations.add(operation)
        try {
            return await operation
        } finally {
            this.#operations.delete(operation)
            this.#running--
            this.#waiting.shift()?.run()
        }
    }

    /**
     * Wait for a turn to run: at once while fewer than `concurrency` operations run
     * @param signal
     * @param deadline the time the operation fails, 0 for none
     * @param limit its time limit, for the message
     */
    async #turn(signal: AbortSignal | undefined, deadline: number, limit: number): Promise<void> {
        if (this.concurrency === undefined || this.#running < this.concurrency) return
        if (signal?.aborted) throw new BarcodeCancelledException('The operation is cancelled')
        await new Promise<void>((resolve, reject): void => {
            let timer: NodeJS.Timeout | undefined
            const waiting = {
                run: (): void => {
                    leave()
                    resolve()
                },
                fail: (error: Error): void => {
                    leave()
                    reject(error)
                }
            }
            const abort = (): void => {
                this.#waiting.splice(this.#waiting.indexOf(waiting), 1)
                waiting.fail(new BarcodeCancelledException('The operation is cancelled'))
            }
            const leave = (): void => {
                if (timer) clearTimeout(timer)
                signal?.removeEventListener('abort', abort)
            }
            signal?.addEventListener('abort', abort, {once: true})
            if (deadline) timer = setTimeout((): void => {
                this.#waiting.splice(this.#waiting.indexOf(waiting), 1)
                waiting.fail(new BarcodeTimeoutException('The operation took longer than its timeout ({0} ms)', limit))
            }, Math.max(0, deadline - Date.now()))
            this.#waiting.push(waiting)
        })
    }
}

/**
 * The options of a barcode component in the configuration of the application: its defaults, its time limit, its
 * concurrency.
 * @param options Its defaults, its time limit, its concurrency, the wait of its destruction.
 * @returns The options of the component.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildBarcodeOptions} from '@lakutata/barcode'
 * Application.run(() => ({
 *     id: 'shop',
 *     name: 'Shop',
 *     components: {
 *         labels: buildBarcodeOptions({defaults: {generate: {scale: 6, showText: true}}, timeout: 5000})
 *     }
 * }))
 * ```
 */
export function buildBarcodeOptions(options: BarcodeConfig = {}): ComponentOptions<BarcodeConfig> {
    return {class: Barcode, ...options}
}
