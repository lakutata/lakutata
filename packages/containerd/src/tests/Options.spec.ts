import {describe, it} from 'node:test'
import assert from 'node:assert'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {InvalidValueException} from '@lakutata/core'
import {GRPCError, GRPCStatus} from '@lakutata/grpc'
import {
    ContainerCreateOptions,
    ContainerStopOptions,
    ContainerdContainerStateException,
    ContainerdPathNotFoundException
} from '../exports/Containerd.js'
import {ContainerdError} from '../containerd/lib/ContainerdErrors.js'

describe('The options and the errors of the containerd component', (): void => {

    const valid = (options: Partial<ContainerCreateOptions>): boolean => ContainerCreateOptions.isValid({image: 'alpine:3.20', ...options})

    it('limits the swap as Docker does: the memory and the swap together, with a memory limit', (): void => {
        assert.ok(valid({memoryLimit: 1024}))
        assert.ok(valid({memoryLimit: 1024, memorySwap: 1024}))
        assert.ok(valid({memoryLimit: 1024, memorySwap: 4096}))
        assert.ok(valid({memoryLimit: 1024, memorySwap: -1}))
        assert.ok(valid({memoryLimit: 1024, memorySwap: 0}))
        assert.ok(valid({memorySwap: -1}))
        assert.ok(!valid({memorySwap: 4096}))
        assert.ok(!valid({memoryLimit: 0, memorySwap: 4096}))
        assert.ok(!valid({memoryLimit: 4096, memorySwap: 1024}))
        assert.ok(!valid({memoryLimit: 1024, memorySwap: -2}))
    })

    it('accepts each access of the devices once', (): void => {
        for (const permissions of ['r', 'w', 'm', 'rw', 'mr', 'rwm', 'mwr']) assert.ok(valid({devices: [{hostPath: '/dev/null', cgroupPermissions: permissions}]}), permissions)
        for (const permissions of ['rr', 'rwr', 'rwmm', 'x', '']) assert.ok(!valid({devices: [{hostPath: '/dev/null', cgroupPermissions: permissions}]}), permissions)
        assert.ok(valid({deviceCgroupRules: ['c 188:* rwm', 'b 8:16 mr', 'a *:* w']}))
        assert.ok(!valid({deviceCgroupRules: ['c 188:* rwr']}))
    })

    it('waits whole seconds for the containers to stop', (): void => {
        assert.ok(ContainerStopOptions.isValid({timeout: 0}))
        assert.ok(ContainerStopOptions.isValid({timeout: 30}))
        assert.ok(!ContainerStopOptions.isValid({timeout: 1.5}))
    })

    it('throws the exceptions of the errors of the client', (): void => {
        assert.ok(ContainerdError(Object.assign(new Error('missing'), {code: 'PATH_NOT_FOUND'})) instanceof ContainerdPathNotFoundException)
        assert.ok(ContainerdError(Object.assign(new Error('not running'), {code: 'NOT_RUNNING'})) instanceof ContainerdContainerStateException)
        assert.ok(ContainerdError(Object.assign(new Error('swap'), {code: 'INVALID_VALUE'})) instanceof InvalidValueException)
        //The errors of containerd are the ones of the store first
        const error: GRPCError = new GRPCError(GRPCStatus.NOT_FOUND, 'not found', '')
        assert.strictEqual(ContainerdError(error), error)
    })

    it('fails its creation when TLS is given to the BuildKit of a unix socket', (): void => {
        //In a process of its own: the fatal exception of the launch ends it
        const script: string = `
            import {Application} from '@lakutata/core'
            import {Containerd} from ${JSON.stringify(new URL('../exports/Containerd.js', import.meta.url).href)}
            Application.run({
                id: 'containerd.options.test.app',
                name: 'containerd-options-test',
                components: {
                    containerd: {
                        class: Containerd,
                        socketPath: ${JSON.stringify(path.join(tmpdir(), 'lakutata-none.sock'))},
                        buildkitAddress: 'unix:///run/buildkit/buildkitd.sock',
                        buildkitTLS: {ca: 'ca'}
                    }
                },
                bootstrap: ['containerd']
            }).onFatalException((error) => {
                console.log('FATAL', error.errno, error.message)
                return 7
            })
        `
        const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', cwd: fileURLToPath(new URL('.', import.meta.url))})
        assert.strictEqual(run.status, 7, run.stdout + run.stderr)
        assert.match(run.stdout, /FATAL E_CONTAINERD_CONNECTION .*BuildKit/)
    })
})
