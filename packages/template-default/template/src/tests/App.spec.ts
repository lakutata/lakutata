import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import {config} from '../config/Config.js'

const PORT: number = 18080

describe('{$APP_NAME}', (): void => {

    let app: Application

    before(async (): Promise<void> => {
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config(PORT)).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
    })

    it('greets', async (): Promise<void> => {
        const response: Response = await fetch(`http://127.0.0.1:${PORT}/example?name=you`)
        assert.deepStrictEqual(await response.json(), {message: 'Hello, you!'})
    })
    //@if i18n

    it('greets in the language of the request', async (): Promise<void> => {
        const response: Response = await fetch(`http://127.0.0.1:${PORT}/example?name=you`, {headers: {'Accept-Language': 'zh-CN,zh;q=0.9'}})
        assert.deepStrictEqual(await response.json(), {message: '你好，you！'})
    })
    //@end
})
