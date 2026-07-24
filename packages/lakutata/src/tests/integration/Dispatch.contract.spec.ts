// Dispatch contract integration test (G1-13 / G1-17 / G1-19).
// Boots a MINIMAL headless Application (log + entrypoint with a service adapter
// that captures the handler; no HTTP server, no CLI readline, no docker, no db)
// and asserts the multi-transport dispatch contracts the monorepo split most
// endangers: action registration across transports, DTO validation, pattern-key
// stripping, and not-found handling. Runs as a node script (like App.spec):
// npm run test:dispatch
//
// IMPORTANT: the Application installs a process-level uncaughtException handler
// that swallows errors thrown out of async onLaunched (logs WARN, exits 0), so
// we CANNOT rely on assertion throws to fail the process. Instead we wrap the
// whole assertion block in try/catch and force process.exit(1) on any failure.
import assert from 'node:assert'
import {Writable} from 'node:stream'
import {Application} from '@lakutata/core'
import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core'
import {Inject} from '@lakutata/core'
import {ServiceAction} from '@lakutata/core'
import {Controller} from '@lakutata/core'
import {Logger} from '@lakutata/core'
import {ServiceContext} from '@lakutata/core'
import {BuildEntrypoints, BuildServiceEntrypoint, Entrypoint} from '@lakutata/core'

class ProbeDTO extends DTO {
    @Expect(DTO.String().required())
    public name: string
}

class ProbeController extends Controller {

    @Inject()
    protected readonly log!: Logger

    @ServiceAction({act: 'probe'}, ProbeDTO)
    public async probe(inp: { name: string }): Promise<string> {
        return `hi:${inp.name}`
    }

}

const nullStream: NodeJS.WritableStream = new Writable({write(_c, _e, cb): void { cb() }})

let serviceHandler: (context: ServiceContext) => Promise<unknown>

Application
    .env({})
    .run((): any => ({
        id: 'dispatch.spec',
        name: 'DispatchSpec',
        components: {
            log: {level: 'silent', destinations: [nullStream]},
            entrypoint: BuildEntrypoints({
                controllers: [ProbeController],
                service: BuildServiceEntrypoint((_module: unknown, handler: (context: ServiceContext) => Promise<unknown>, onDestroy: (fn: () => void) => void): void => {
                    serviceHandler = handler
                    onDestroy((): void => {})
                })
            })
        },
        bootstrap: ['entrypoint']
    }))
    .onLaunched(async (app): Promise<void> => {
        try {
            const entrypoint = await app.getObject<Entrypoint>('entrypoint')

            //G1-13: the action is registered in the service transport action list.
            assert.ok(
                JSON.stringify(entrypoint.getServiceActions()).includes('"act":"probe"'),
                'probe action must be registered in the service action list'
            )

            //G1-19: a valid dispatch returns the controller method's value, and the
            //routing pattern keys (act) are stripped from the input the method sees
            //(the method receives {name}, not {act,name}).
            const result = await serviceHandler(new ServiceContext({data: {act: 'probe', name: 'world'}}))
            assert.equal(result, 'hi:world', 'valid service dispatch must return the method result')

            //G1-17: a service action declared with a DTO rejects invalid input
            //(missing required `name`) BEFORE the controller method runs.
            await assert.rejects(
                serviceHandler(new ServiceContext({data: {act: 'probe'}})),
                'invalid input must be rejected by DTO validation before the method runs'
            )

            //G1-19: an unmatched pattern is rejected (ControllerActionNotFoundException).
            await assert.rejects(
                serviceHandler(new ServiceContext({data: {act: 'nope'}})),
                'an unmatched service pattern must reject'
            )
        } catch (e) {
            console.error('DISPATCH CONTRACT FAILED:\n', e)
            process.exit(1)
        }
        app.exit(0)
    })
    .onFatalException((error: Error): number => {
        console.error(error)
        return 100
    })
