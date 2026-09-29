import type {ApplicationOptions} from 'lakutata'
import {BuildEntrypoints} from 'lakutata/com/entrypoint'
import {ExpressHTTPEntrypoint} from 'lakutata/adapter/express'
import {ExampleController} from '../controllers/ExampleController.js'

/**
 * The options of the application
 * @param port the port of the HTTP server, the PORT environment variable or 8080 by default
 */
export function Config(port: number = Number(process.env.PORT ?? 8080)): ApplicationOptions {
    return {
        id: '{$APP_ID}',
        name: '{$APP_NAME}',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            entrypoint: BuildEntrypoints({
                controllers: [ExampleController],
                http: ExpressHTTPEntrypoint({port: port})
            })
        },
        bootstrap: ['entrypoint']
    }
}
