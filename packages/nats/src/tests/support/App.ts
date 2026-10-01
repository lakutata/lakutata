import {describe} from 'node:test'
import {Application, ApplicationOptions} from '@lakutata/core'
import {Entrypoint} from '@lakutata/entrypoint'

//The applications of the tests dispatch with the Entrypoint component (as the applications of the lakutata package)
Application.preset({components: {entrypoint: {class: Entrypoint}}})

/**
 * The NATS server of the integration tests (docker-compose.test.yml), they are skipped without it
 */
export const NATS_URL: string | undefined = process.env.NATS_URL

/**
 * A describe skipped without NATS server
 */
export const describeNats: typeof describe = (NATS_URL ? describe : describe.skip) as typeof describe

/**
 * Run an application, resolved when it is launched
 * @param options
 */
export function runApp(options: ApplicationOptions): Promise<Application> {
    return new Promise<Application>((resolve: (app: Application) => void, reject: (error: Error) => void): void => {
        Application.run(options)
            .onLaunched(async (app: Application): Promise<void> => resolve(app))
            .onUncaughtException((error: Error): void => reject(error))
    })
}

/**
 * Tear a test application down with its objects (the NATS connections included) without exiting the process
 * @param app
 */
export async function destroyApp(app: Application): Promise<void> {
    await app.dispose()
}

/**
 * The NATS server of the tests (started by docker-compose.test.yml)
 */
export async function ensureNats(): Promise<{ url: string }> {
    return {url: NATS_URL!}
}

/**
 * Nothing to stop: the NATS server is shared by the tests
 */
export async function stopNats(): Promise<void> {
}
