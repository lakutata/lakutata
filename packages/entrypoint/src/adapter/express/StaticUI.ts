import express, {type NextFunction, type Request, type RequestHandler, type Response} from 'express'
import path from 'node:path'
import {parseDuration} from '../../lib/schedule/Cron.js'

/**
 * The options of {@link staticUI}.
 */
export type StaticUIOptions = {
    /**
     * Serve a single-page application: a GET or HEAD request accepting HTML, whose path has no file extension and
     * matches no file, is answered with the index (the client-side router handles the path). With `false`, such a
     * request is passed on (a 404 behind `expressHTTPEntrypoint`).
     * @default true
     */
    spa?: boolean
    /**
     * The index file of the application, relative to the directory.
     * @default 'index.html'
     */
    index?: string
    /**
     * How long the browsers may cache the files with a content hash in their name (the assets of a Vite build:
     * `index-B2x9fQ1a.js`): a number of seconds, or a duration (`'30d'`, `'12h'`; a string of digits is seconds). A file
     * counts as hashed when it is a script, a style, a font or an image whose name ends with a dot or a dash followed by
     * at least 8 letters, digits, `_` or `-`, among them a digit or an uppercase letter, before its extension
     * (`index-B2x9fQ1a.js`, `main.3f2a1b9c.css`, not `my-component.js`). The other files and the index are sent with
     * `Cache-Control: no-cache`.
     * @default 31536000 (one year)
     */
    assetsMaxAge?: string | number
}

/**
 * Whether a file of a built UI has a content hash in its name: a script, a style, a font or an image whose name ends
 * with a dot or a dash followed by at least 8 letters, digits, `_` or `-`, among them a digit or an uppercase letter
 * @param file
 * @internal
 */
export function isHashedAsset(file: string): boolean {
    const matched: RegExpExecArray | null = /[.-]([0-9A-Za-z_-]{8,})\.(?:js|mjs|css|woff2?|png|jpe?g|svg|gif|webp|avif)$/.exec(file)
    return !!matched && /[0-9A-Z]/.test(matched[1])
}

/**
 * The seconds the hashed assets are cached: a number of seconds, or a duration
 * @param value
 * @internal
 */
export function assetsMaxAge(value: string | number | undefined): number {
    if (value === undefined) return 31536000
    const seconds: number = typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : parseDuration(value) / 1000
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError(`Invalid assetsMaxAge "${value}": a number of seconds or a duration ("30d")`)
    return Math.floor(seconds)
}

/**
 * Create an express handler serving a built web UI (the `dist` directory of a Vite application): its files, and its
 * index for the paths of its client-side routes. Given as the `fallback` of {@link expressHTTPEntrypoint}, it never
 * receives the paths of the actions. It needs the optional peer dependency `express`.
 *
 * The files with a content hash in their name are cached for a long time (`assetsMaxAge`), the other files and the
 * index are revalidated on each request. A request matching no file that is not a page request (an asset, a non-GET
 * request, a client not accepting HTML) is passed on to the next handler.
 * @param directory The directory of the built UI, resolved from the current working directory.
 * @param options How the index is served and the assets cached.
 * @returns The express request handler.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {GET} from 'lakutata/decorator/ctrl'
 * import {expressHTTPEntrypoint, staticUI} from 'lakutata/adapter/express'
 *
 * class DeviceController extends Controller {
 *     //GET /api/devices answers the action; GET /settings answers the index of the UI
 *     @GET('/api/devices')
 *     public async list(): Promise<string[]> {
 *         return ['sensor-1']
 *     }
 * }
 *
 * Application.run({
 *     id: 'console.app',
 *     name: 'Console',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [DeviceController],
 *             http: expressHTTPEntrypoint({
 *                 port: 8080,
 *                 fallback: staticUI('./ui/dist', {assetsMaxAge: 86400})
 *             })
 *         })
 *     }
 * })
 * ```
 */
export function staticUI(directory: string, options: StaticUIOptions = {}): RequestHandler {
    const root: string = path.resolve(directory)
    const index: string = options.index ?? 'index.html'
    const maxAge: number = assetsMaxAge(options.assetsMaxAge)
    const files: RequestHandler = express.static(root, {
        index: false,
        setHeaders: (response: Response, file: string): void => {
            if (isHashedAsset(file)) response.setHeader('Cache-Control', `public, max-age=${maxAge}, immutable`)
            else response.setHeader('Cache-Control', 'no-cache')
        }
    })
    return (request: Request, response: Response, next: NextFunction): void => {
        files(request, response, (error?: unknown): void => {
            if (error) return next(error)
            //The routes of the application are its index; the missing files are not
            const wantsPage: boolean = (request.method === 'GET' || request.method === 'HEAD') && !path.extname(request.path) && request.accepts('html') === 'html'
            if (options.spa === false || !wantsPage) return next()
            response.setHeader('Cache-Control', 'no-cache')
            response.sendFile(path.join(root, index), (sendError?: Error): void => {
                if (sendError) next(sendError)
            })
        })
    }
}
