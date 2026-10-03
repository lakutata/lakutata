import {ResourcesPath, type ApplicationOptions} from 'lakutata'
import {BuildEntrypoints} from 'lakutata/com/entrypoint'
import {ExpressHTTPEntrypoint, JSONEnvelope, StaticUI} from 'lakutata/adapter/express'
import compression from 'compression'
import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {Authenticate} from '../middlewares/Authenticate.js'
import {ExampleController} from '../controllers/ExampleController.js'
import {HealthController} from '../controllers/HealthController.js'
//@if i18n
import {BuildI18nOptions, I18nMiddleware} from 'lakutata/com/i18n'
import en from '../locales/en.json' with {type: 'json'}
import zhCN from '../locales/zh-CN.json' with {type: 'json'}
//@end

/**
 * The directory of the built application of the ui package, undefined before it is built (in development, Vite serves it):
 * in the resources of the packed application (lakutata bundle, lakutata executable: the "lakutata.resources" of its
 * package.json), else in the ui package
 */
function UIDirectory(): string | undefined {
    const resources: string | undefined = ResourcesPath()
    try {
        const directory: string = resources ? path.join(resources, 'ui') : path.join(path.dirname(createRequire(import.meta.url).resolve('ui/package.json')), 'dist')
        return existsSync(path.join(directory, 'index.html')) ? directory : undefined
    } catch {
        return undefined
    }
}

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
                    before: (app): void => void app.use(compression()),
                    //The paths outside of the actions are the pages of the application
                    fallback: ((directory: string | undefined) => directory ? StaticUI(directory) : undefined)(UIDirectory())
                })
            })
        },
        bootstrap: ['entrypoint']
    }
}
