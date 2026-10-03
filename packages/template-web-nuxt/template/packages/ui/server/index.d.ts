import type {IncomingMessage, ServerResponse} from 'node:http'

/**
 * The handler of the pages: given as the fallback of the express adapter, the paths of the actions are not given to it
 */
export type UIHandler = (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => void

/**
 * The Nuxt application of the ui package, served by the service: undefined until it is built (in development, nuxt dev serves it)
 * @param options the build of Nitro: the one of the ui package by default, the one of the resources of the application
 * packed (lakutata executable)
 */
export default function renderUI(options?: { output?: string }): UIHandler | undefined
