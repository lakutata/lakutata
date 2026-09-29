import type {ApplicationOptions} from 'lakutata'
import {BuildEntrypoints} from 'lakutata/com/entrypoint'
import {ExpressHTTPEntrypoint, JSONEnvelope} from 'lakutata/adapter/express'
import compression from 'compression'
import renderUI from 'ui'
import {Authenticate} from '../middlewares/Authenticate.js'
import {ExampleController} from '../controllers/ExampleController.js'
import {HealthController} from '../controllers/HealthController.js'

/**
 * The options of the service
 * @param port the port of the HTTP server, the PORT environment variable or 8080 by default
 */
export function Config(port: number = Number(process.env.PORT ?? 8080)): ApplicationOptions {
    return {
        id: '{$APP_ID}',
        name: '{$APP_NAME}',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            entrypoint: BuildEntrypoints({
                controllers: [HealthController, ExampleController],
                http: ExpressHTTPEntrypoint({
                    port: port,
                    //The results and the errors are {errno, errMsg, data}, with the status 200
                    respond: JSONEnvelope({errorStatus: 200}),
                    body: {limit: '100mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    middlewares: [Authenticate],
                    before: (app): void => void app.use(compression()),
                    //The paths outside of the actions are the pages of the Nuxt application, once it is built (in development, nuxt dev serves them)
                    fallback: renderUI()
                })
            })
        },
        bootstrap: ['entrypoint']
    }
}
