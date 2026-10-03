import {cpSync, existsSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * Complete the standalone build of next (.next/standalone, output: 'standalone') with the files it leaves out (the ones of
 * .next/static and public), and write where the application is in it (ui.json): it is the one the application packed
 * serves (lakutata.resources of the app package)
 */
const ui: string = fileURLToPath(new URL('../../', import.meta.url))
const standalone: string = path.join(ui, '.next', 'standalone')
//The path of the application from the root of the files traced (the one of the workspace)
const {relativeAppDir} = JSON.parse(readFileSync(path.join(ui, '.next', 'required-server-files.json'), 'utf8')) as { relativeAppDir: string }
const application: string = path.join(standalone, relativeAppDir)
cpSync(path.join(ui, '.next', 'static'), path.join(application, '.next', 'static'), {recursive: true})
if (existsSync(path.join(ui, 'public'))) cpSync(path.join(ui, 'public'), path.join(application, 'public'), {recursive: true})
writeFileSync(path.join(standalone, 'ui.json'), JSON.stringify({dir: relativeAppDir}))
