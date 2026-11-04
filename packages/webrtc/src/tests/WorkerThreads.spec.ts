import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

/**
 * A compiled module of the package, as the specifier of an import
 * @param file Its path from the compiled tests.
 */
function compiled(file: string): string {
    return JSON.stringify(new URL(file, import.meta.url).href)
}

describe('The worker threads of the package', (): void => {

    it('start in a process whose code is an ES module given on the command line (--input-type=module)', {timeout: 90000}, (): void => {
        //Started from such a process: the threads do not inherit its options of the command line, which would run their
        //code (CommonJS) as an ES module. The TURN server runs its threads on Linux only
        const result = spawnSync(process.execPath, ['--max-old-space-size=512', '--input-type=module', '-e', `
            import {Container} from '@lakutata/core'
            import {PeerConnection, PeerThreads} from ${compiled('../exports/WebRTC.js')}
            import {turnWorkers} from ${compiled('../turn/TURNWorkers.js')}
            import {DnsLookup} from ${compiled('../lib/ice/dns/lookup.js')}
            import {startServer} from ${compiled('./support/Server.js')}
            const server = await startServer({turn: {workers: 2}, sfu: {workers: 2}})
            const container = new Container()
            await container.setNamed('threads', PeerThreads, {threads: 1})
            const connection = await container.get(PeerConnection, {threads: 'threads'})
            connection.createDataChannel('data')
            await connection.setLocalDescription()
            const address = await new DnsLookup().lookup('localhost')
            console.log(JSON.stringify({turn: turnWorkers.has(server.turn), offer: connection.localDescription?.type, address: address}))
            await container.destroy()
            await server.stop()
        `], {cwd: fileURLToPath(new URL('../../..', import.meta.url)), encoding: 'utf8', timeout: 80000})
        assert.strictEqual(result.status, 0, result.stderr)
        const output: {turn: boolean, offer: string, address: string} = JSON.parse(result.stdout.trim().split('\n').at(-1)!)
        assert.deepStrictEqual({turn: output.turn, offer: output.offer}, {turn: process.platform === 'linux', offer: 'offer'})
        assert.match(output.address, /^(127\.0\.0\.1|::1)$/)
    })
})
