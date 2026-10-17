import type {IncomingMessage} from 'node:http'

/**
 * Read the body of a request, up to a limit. Over the limit, it fails with a 413 error at once, and the rest of the body
 * is read and dropped: the connection stays usable for the next request of the client (closing it while the client
 * still sends would fail its request, keeping it unread would fail the next one)
 * @param request
 * @param limit bytes
 */
export function readBody(request: IncomingMessage, limit: number): Promise<string> {
    return new Promise((resolve: (body: string) => void, reject: (error: Error) => void): void => {
        const chunks: Buffer[] = []
        let size: number = 0
        const end = (): void => resolve(Buffer.concat(chunks).toString('utf8'))
        const collect = (chunk: Buffer): void => {
            size += chunk.length
            if (size <= limit) return void chunks.push(chunk)
            request.off('data', collect).off('end', end).on('data', (): void => undefined)
            reject(Object.assign(new Error(`The body of the request is larger than ${limit} bytes`), {statusCode: 413}))
        }
        request.on('data', collect).once('end', end).once('error', reject)
    })
}
