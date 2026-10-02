import type {ApplicationOptions} from 'lakutata'
import {BuildEntrypoints} from 'lakutata/com/entrypoint'
import {ExpressHTTPEntrypoint, JSONEnvelope} from 'lakutata/adapter/express'
import compression from 'compression'
import renderUI, {type UIHandler} from 'ui'
import {Authenticate} from '../middlewares/Authenticate.js'
import {ExampleController} from '../controllers/ExampleController.js'
import {HealthController} from '../controllers/HealthController.js'
//@if i18n
import {BuildI18nOptions, I18nMiddleware} from 'lakutata/com/i18n'
import en from '../locales/en.json' with {type: 'json'}
import zhCN from '../locales/zh-CN.json' with {type: 'json'}
//@end

/**
 * The options of the service
 * @param port the port of the HTTP server, the PORT environment variable or 8080 by default
 */
export function Config(port: number = Number(process.env.PORT ?? 8080)): ApplicationOptions {
    //The pages are compiled on demand in development, served from the build of next in production
    const ui: UIHandler = renderUI({dev: process.env.NODE_ENV !== 'production'})
    return {
        id: '{$APP_ID}',
        name: '{$APP_NAME}',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //@if i18n
            //The messages of the languages (src/locales), bundled with the code; created by the first request
            i18n: BuildI18nOptions({messages: {'en': en, 'zh-CN': zhCN}}),
            //@end
            entrypoint: BuildEntrypoints({
                controllers: [HealthController, ExampleController],
                //@if i18n
                //The messages in the language of each request: ?lang=, the cookie lang, Accept-Language
                middlewares: [I18nMiddleware],
                //@end
                http: ExpressHTTPEntrypoint({
                    port: port,
                    //The results and the errors are {errno, errMsg, data}, with the status 200
                    respond: JSONEnvelope({errorStatus: 200}),
                    body: {limit: '100mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    middlewares: [Authenticate],
                    before: (app, {server}): void => {
                        app.use(compression())
                        ui.attach(server)
                    },
                    //The paths outside of the actions are the pages of the Next.js application
                    fallback: ui
                })
            })
        },
        bootstrap: ['entrypoint']
    }
}
