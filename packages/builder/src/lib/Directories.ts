import {cp, mkdir} from 'node:fs/promises'
import path from 'node:path'
import {runCommand} from './Processes.js'

/**
 * Copy a directory into another one, its links kept as they are: cp -a on macOS and Linux (the copy of Node.js turns
 * the relative links into absolute ones before Node.js 18.17 and 20.2: its option verbatimSymlinks), the copy of Node.js
 * on Windows (its directories have no links)
 * @param source
 * @param target
 */
export async function copyDirectory(source: string, target: string): Promise<void> {
    if (process.platform === 'win32') return await cp(source, target, {recursive: true})
    await mkdir(target, {recursive: true})
    const copied = await runCommand('cp', ['-a', `${source}/.`, target], path.dirname(target))
    if (copied.code !== 0) throw new Error(`${source} cannot be copied: ${copied.output.trim()}`)
}
