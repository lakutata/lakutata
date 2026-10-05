import {describe} from 'node:test'
import {spawn, spawnSync, type ChildProcess} from 'node:child_process'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'

/**
 * Whether dbus-daemon is installed: the tests of the bus are skipped without it
 */
export const HAS_DBUS_DAEMON: boolean = spawnSync('dbus-daemon', ['--version']).status === 0

/**
 * A describe skipped without dbus-daemon
 */
export const describeBus: typeof describe = (HAS_DBUS_DAEMON ? describe : describe.skip) as typeof describe

/**
 * A private bus of the tests
 */
export type TestBus = {
    readonly socket: string
    stop(): Promise<void>
}

/**
 * Start a private bus listening on a socket of a temporary directory
 */
export async function startBus(): Promise<TestBus> {
    const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-dbus-'))
    const socket: string = path.join(directory, 'bus.sock')
    const config: string = path.join(directory, 'bus.conf')
    writeFileSync(config, `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path=${socket}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy>
</busconfig>`)
    const daemon: ChildProcess = spawn('dbus-daemon', [`--config-file=${config}`, '--nofork', '--print-address'], {stdio: ['ignore', 'pipe', 'inherit']})
    //The daemon prints its address once it listens
    await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
        daemon.stdout!.once('data', (): void => resolve())
        daemon.once('error', reject)
        daemon.once('exit', (code: number | null): void => reject(new Error(`dbus-daemon exited (${code})`)))
    })
    return {
        socket: socket,
        stop: async (): Promise<void> => {
            await new Promise<void>((resolve: () => void): void => {
                daemon.once('exit', (): void => resolve())
                daemon.kill()
            })
            rmSync(directory, {recursive: true, force: true})
        }
    }
}
