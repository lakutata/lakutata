import {createRequire} from 'node:module'

/**
 * Whether the node program running the tests makes the executables of Node.js: the assets of the single executable
 * applications (Node.js 20.12, 21.7 and later)
 */
function seaAssets(): boolean {
    try {
        return typeof createRequire(import.meta.url)('node:sea').getAsset === 'function'
    } catch {
        return false
    }
}

/**
 * The options of lakutata package exe and installer for the executables of Node.js: none where the node program running
 * the tests makes them, else the node program of LAKUTATA_NODE_PROGRAM (a newer Node.js: an older one runs the tests)
 */
export const NODE_PROGRAM: string[] = !seaAssets() && process.env.LAKUTATA_NODE_PROGRAM ? ['--node-program', process.env.LAKUTATA_NODE_PROGRAM] : []

/**
 * Why a test making an executable of Node.js is skipped: the node program running the tests does not make them, and
 * LAKUTATA_NODE_PROGRAM gives none that does
 */
export const NO_NODE_EXECUTABLE: string | false = seaAssets() || process.env.LAKUTATA_NODE_PROGRAM ? false : 'the executables of Node.js are made by Node.js 20.12, 21.7 or later (LAKUTATA_NODE_PROGRAM: another node program)'
