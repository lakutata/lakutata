import express, {type NextFunction, type Request, type RequestHandler, type Response} from 'express'
import path from 'node:path'

export type StaticUIOptions = {
    /**
     * A single-page application: the paths without file are given its index, true by default
     */
    spa?: boolean
    /**
     * The index of the application, "index.html" by default
     */
    index?: string
    /**
     * The cache of the files with a hash in their name (the assets of the builds of Vite…), 1 year by default; the index is never cached
     */
    assetsMaxAge?: string | number
}

/**
 * Serve the files of a built UI (the dist directory of a Vite application): its files, and its index for the paths of its routes.
 * Given as the fallback of ExpressHTTPEntrypoint, the paths of the actions are not given to it
 * @param directory
 * @param options
 */
export function StaticUI(directory: string, options: StaticUIOptions = {}): RequestHandler {
    const root: string = path.resolve(directory)
    const index: string = options.index ?? 'index.html'
    const hashed: RegExp = /[.-][0-9A-Za-z_-]{8,}\.(?:js|mjs|css|woff2?|png|jpe?g|svg|gif|webp|avif)$/
    const files: RequestHandler = express.static(root, {
        index: false,
        setHeaders: (response: Response, file: string): void => {
            if (hashed.test(file)) response.setHeader('Cache-Control', `public, max-age=${Math.floor(Number(options.assetsMaxAge ?? 31536000))}, immutable`)
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
