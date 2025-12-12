import {execa} from 'execa'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {readFile} from 'node:fs/promises'
import chalk from 'chalk'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distroDir = path.resolve(__dirname, 'distro')
const distroPackageJson = JSON.parse(await readFile(path.resolve(distroDir, 'package.json'), {encoding: 'utf-8'}))

process.exit(await (async () => {
    try {
        await execa('npm', ['publish'], {cwd: distroDir, stdio: 'inherit'})
        console.info(chalk.green(`Version ${distroPackageJson.version} has been successfully published`))
        return 0
    } catch (e) {
        console.info(`${chalk.red('The publication encountered an error and failed to be published:')}\n${chalk.red(e.message)}`)
        return 1
    }
})())