import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * Complete the standalone build of next (.next/standalone, output: 'standalone') with the files it leaves out (the ones of
 * .next/static and public), and write where the application is in it (ui.json): it is the one the application packed
 * serves (lakutata.resources of the app package)
 */
const ui: string = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Copy a directory, file by file: the copies of cpSync are written before their mode is given, which the directories
 * shared with the containers (Docker Desktop) refuse to their root
 * @param from
 * @param to
 */
function copyPackages(from: string, to: string): void {
    if (!statSync(from).isDirectory()) return copyFileSync(from, to)
    mkdirSync(to, {recursive: true})
    for (const entry of readdirSync(from)) copyPackages(path.join(from, entry), path.join(to, entry))
}

const standalone: string = path.join(ui, '.next', 'standalone')
//The path of the application from the root of the files traced (the one of the workspace)
const {relativeAppDir} = JSON.parse(readFileSync(path.join(ui, '.next', 'required-server-files.json'), 'utf8')) as { relativeAppDir: string }
const application: string = path.join(standalone, relativeAppDir)
copyPackages(path.join(ui, '.next', 'static'), path.join(application, '.next', 'static'))
if (existsSync(path.join(ui, 'public'))) copyPackages(path.join(ui, 'public'), path.join(application, 'public'))
writeFileSync(path.join(standalone, 'ui.json'), JSON.stringify({dir: relativeAppDir}))
