import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
import {ExampleController} from '../controllers/ExampleController.js'
//@if i18n
import {buildI18nOptions, I18nMiddleware} from 'lakutata/com/i18n'
import en from '../locales/en.json' with {type: 'json'}
import zhCN from '../locales/zh-CN.json' with {type: 'json'}
//@end

/**
 * The options of the application
 * @param port the port of the HTTP server, the PORT environment variable or 8080 by default
 */
export function config(port: number = Number(process.env.PORT ?? 8080)): ApplicationOptions {
    return {
        id: '{$APP_ID}',
        name: '{$APP_NAME}',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //@if i18n
            //The messages of the languages (src/locales), bundled with the code; created by the first request
            i18n: buildI18nOptions({messages: {'en': en, 'zh-CN': zhCN}}),
            //@end
            entrypoint: buildEntrypoints({
                controllers: [ExampleController],
                //@if i18n
                //The messages in the language of each request: ?lang=, the cookie lang, Accept-Language
                middlewares: [I18nMiddleware],
                //@end
                http: expressHTTPEntrypoint({port: port})
            })
        },
        bootstrap: ['entrypoint']
    }
}
