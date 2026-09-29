import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {Application} from 'lakutata'
import {Config} from '../config/Config.js'

const PORT: number = Number(process.env.TEST_PORT ?? 18081)

describe('{$APP_NAME}', (): void => {

    let app: Application

    before(async (): Promise<void> => {
        process.env.API_TOKEN = 'test-token'
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(Config(PORT)).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
    })

    it('answers the health check without authentication', async (): Promise<void> => {
        assert.deepStrictEqual(await (await fetch(`http://127.0.0.1:${PORT}/health`)).json(), {errno: null, errMsg: null, data: {status: 'ok'}})
    })

    it('greets the authenticated requests', async (): Promise<void> => {
        const response: Response = await fetch(`http://127.0.0.1:${PORT}/example?name=you`, {headers: {Authorization: 'Bearer test-token'}})
        assert.deepStrictEqual(await response.json(), {errno: null, errMsg: null, data: {message: 'Hello, you!'}})
    })

    it('refuses the requests without authentication', async (): Promise<void> => {
        const response: Response = await fetch(`http://127.0.0.1:${PORT}/example`)
        assert.strictEqual(response.status, 200)
        assert.deepStrictEqual(await response.json(), {errno: 'E_UNAUTHORIZED', errMsg: 'The request is not authenticated', data: null})
    })
})
