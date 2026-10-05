import assert from 'node:assert'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Application, Component, type ApplicationExitReason} from '../../../exports/Lakutata.js'
import {buildEntrypoints, Controller} from '../../../exports/EntrypointComponent.js'
import {expressHTTPEntrypoint, jsonEnvelope} from '../../../exports/ExpressAdapter.js'
import {GET} from '../../../exports/CTRLDecorators.js'
import {Inject} from '../../../exports/DIDecorators.js'
import {buildDatabaseOptions, Database} from '../../../exports/DatabaseComponent.js'
import {FreePort, RunChecks} from '../support/Scenario.js'

/**
 * A component telling its destruction
 */
class Recorder extends Component {
    protected async destroy(): Promise<void> {
        console.log('DESTROYED recorder')
    }
}

class SlowController extends Controller {
    @Inject('db')
    protected readonly db: Database

    @GET('/fast')
    public async fast(): Promise<string> {
        return 'fast'
    }

    /**
     * A request running while the application exits: it uses the database once it waited
     */
    @GET('/slow')
    public async slow(): Promise<unknown> {
        await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 400))
        return await this.db.query('SELECT 1 AS done')
    }
}

const port: number = await FreePort()
const url = (route: string): string => `http://127.0.0.1:${port}${route}`

Application
    .run(() => ({
        id: 'integration.shutdown',
        name: 'IntegrationShutdown',
        components: {
            log: {level: 'warn'},
            recorder: {class: Recorder},
            db: buildDatabaseOptions({type: 'sqlite', database: path.join(mkdtempSync(path.join(tmpdir(), 'lakutata-shutdown-')), 'app.db')}),
            entrypoint: buildEntrypoints({
                controllers: [SlowController],
                http: expressHTTPEntrypoint({port: port, host: '127.0.0.1', respond: jsonEnvelope({errorStatus: 200})})
            })
        },
        bootstrap: ['recorder', 'db', 'entrypoint']
    }))
    .onLaunched((app: Application): Promise<void> => RunChecks(app, async (check): Promise<void> => {
        await check('the application serves its requests before it exits', async (): Promise<void> => {
            assert.strictEqual(((await (await fetch(url('/fast'))).json()) as { data: string }).data, 'fast')
        })
    }, (): void => {
        //The process receives SIGTERM (docker stop) while a request runs, then a request comes (told to Integration.spec)
        fetch(url('/slow')).then((response: Response): Promise<unknown> => response.json()).then(
            (body: unknown): void => console.log(`SLOW ${JSON.stringify(body)}`),
            (error: Error): void => console.log(`SLOW failed: ${error.message}`)
        )
        setTimeout((): void => {
            process.kill(process.pid, 'SIGTERM')
            setTimeout((): void => {
                fetch(url('/fast')).then((response: Response): Promise<unknown> => response.json()).then(
                    (body: unknown): void => console.log(`NEW served ${JSON.stringify(body)}`),
                    (error: Error): void => console.log(`NEW refused: ${error.message}`)
                )
            }, 50)
        }, 100)
    }))
    .onDone((_app: Application, _logger: unknown, reason: ApplicationExitReason): void => console.log(`DONE the application is done ${JSON.stringify(reason)}`))
    .onFatalException((error: Error): number => {
        console.error(error)
        return 1
    })
