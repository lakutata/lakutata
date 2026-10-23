import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {createTurnClient, type TurnProtocol} from '../lib/ice/turn/protocol.js'
import {TURNServer} from '../turn/TURNServer.js'

/**
 * Allocations of clients of a server, each with a user of its own, the clients put in the list given as they allocate
 * (the caller closes them, even when one fails)
 * @param port
 * @param count
 * @param clients
 */
async function allocate(port: number, count: number, clients: TurnProtocol[]): Promise<void> {
    for (let index = 0; index < count; index += 50) {
        const results: PromiseSettledResult<TurnProtocol>[] = await Promise.allSettled(Array.from({length: Math.min(50, count - index)}, (_: unknown, offset: number): Promise<TurnProtocol> => createTurnClient({address: ['127.0.0.1', port], username: `user${index + offset}`, password: 'password'})))
        for (const result of results) if (result.status === 'fulfilled') clients.push(result.value)
        const failed: PromiseRejectedResult | undefined = results.find((result: PromiseSettledResult<TurnProtocol>): result is PromiseRejectedResult => result.status === 'rejected')
        if (failed) throw failed.reason
    }
}

describe('TURNServer', (): void => {

    it('makes as many allocations as asked without maxAllocations', {timeout: 60000}, async (): Promise<void> => {
        const container: Container = new Container()
        const users: Record<string, string> = Object.fromEntries(Array.from({length: 300}, (_: unknown, index: number): [string, string] => [`user${index}`, 'password']))
        await container.setNamed('turn', TURNServer, {host: '127.0.0.1', port: 0, publicAddress: '127.0.0.1', users: users})
        const clients: TurnProtocol[] = []
        try {
            const turn: TURNServer = await container.get<TURNServer>('turn')
            //More than the 256 of the engine
            await allocate(turn.address.port, 300, clients)
            assert.strictEqual(turn.allocations, 300)
        } finally {
            await Promise.all(clients.map((client: TurnProtocol): Promise<unknown> => client.close().catch((): undefined => undefined)))
            await container.destroy()
        }
    })
})
