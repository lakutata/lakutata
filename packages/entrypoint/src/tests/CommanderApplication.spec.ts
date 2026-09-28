import {describe, it} from 'node:test'
import assert from 'node:assert'
import {PassThrough} from 'node:stream'
import {Application, Component} from '@lakutata/core'
import {SetDefaultComponent} from '@lakutata/core/internal'
import {BuildEntrypoints, Controller, Entrypoint} from '../exports/Entrypoint.js'
import {CLIAction} from '../exports/CTRLDecorators.js'
import {CommanderCLIEntrypoint} from '../exports/CommanderAdapter.js'
import {ExpressHTTPEntrypoint} from '../exports/ExpressAdapter.js'

//The entrypoint is a default component of the lakutata package, not of the core
SetDefaultComponent('entrypoint', {class: Entrypoint})

const trace: string[] = []

/**
 * A component bootstrapped after the entrypoint, slow to start
 */
class SlowComponent extends Component {
    public ready: boolean = false

    protected async init(): Promise<void> {
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 200))
        this.ready = true
        trace.push('slow ready')
    }
}

class ToolController extends Controller {
    @CLIAction('ping')
    public async ping(): Promise<string> {
        trace.push('command')
        return 'pong'
    }
}

describe('Commander adapter in an application', (): void => {

    it('runs the command once the application launched', async (): Promise<void> => {
        const stdout: PassThrough = new PassThrough()
        let output: string = ''
        stdout.on('data', (chunk: Buffer): unknown => output += chunk.toString())
        let app: Application | undefined
        const code: number = await new Promise<number>((resolve: (code: number) => void, reject: (error: Error) => void): void => {
            Application.run({
                id: 'commander.app',
                name: 'CommanderApp',
                components: {
                    slow: {class: SlowComponent},
                    //The CLI adapter comes first and the entrypoint is bootstrapped first: the command still waits for the others
                    entrypoint: BuildEntrypoints({
                        controllers: [ToolController],
                        cli: CommanderCLIEntrypoint({argv: ['ping'], interactive: false, stdout: stdout, exit: resolve}),
                        http: ExpressHTTPEntrypoint({
                            port: 0,
                            host: '127.0.0.1',
                            before: async (): Promise<void> => {
                                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 100))
                                trace.push('http started')
                            }
                        })
                    })
                },
                bootstrap: ['entrypoint', 'slow']
            })
                .onLaunched((launched: Application): void => {
                    app = launched
                })
                .onUncaughtException(reject)
        })
        assert.strictEqual(code, 0)
        assert.strictEqual(output, 'pong\n')
        assert.deepStrictEqual(trace, ['http started', 'slow ready', 'command'])
        assert.ok(app)
        await app.dispose()
    })
})
