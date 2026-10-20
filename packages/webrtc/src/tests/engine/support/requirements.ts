/**
 * The options of the tests needing more than the machine: they are skipped, with the reason, when it is missing
 */
import {spawnSync} from 'node:child_process'
import type {TestOptions} from './vitest.js'

/**
 * The tests reaching servers on the public internet (stun.l.google.com): run with WEBRTC_NETWORK_TESTS=1
 */
export const networkTests: TestOptions = process.env.WEBRTC_NETWORK_TESTS === '1'
    ? {}
    : {skip: 'needs the public internet (set WEBRTC_NETWORK_TESTS=1 to run it)'}

/**
 * The tests running the openssl command
 */
export const opensslTests: TestOptions = spawnSync('openssl', ['version']).error === undefined
    ? {}
    : {skip: 'needs the openssl command on the PATH'}
