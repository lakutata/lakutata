import {Agent, request, type IncomingMessage} from 'node:http'

/**
 * Post a body through an agent keeping its connections alive, one at a time: the requests of a client reusing its
 * connection
 * @param url
 * @param body
 * @param agent
 */
export function postThrough(url: string, body: string, agent: Agent): Promise<{ status: number, body: string }> {
    return new Promise((resolve: (value: { status: number, body: string }) => void, reject: (error: Error) => void): void => {
        const posted = request(url, {method: 'POST', agent: agent, headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}}, (response: IncomingMessage): void => {
            let text: string = ''
            response.setEncoding('utf8').on('data', (chunk: string): unknown => text += chunk).once('end', (): void => resolve({status: response.statusCode!, body: text}))
        })
        posted.once('error', reject).end(body)
    })
}

/**
 * An agent keeping its connections alive, one at a time
 */
export function keepAliveAgent(): Agent {
    return new Agent({keepAlive: true, maxSockets: 1})
}
