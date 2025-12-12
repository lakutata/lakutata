import cliSpinners from 'cli-spinners'
import logUpdate from 'log-update'
import {execa} from 'execa'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {cp, readFile} from 'node:fs/promises'
import chalk from 'chalk'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const spinnerJob = async (description, job, successHandler, errorHandler) => {
    let i = 0
    const spinnerInterval = setInterval(() => {
        const frames = cliSpinners.dots.frames
        const text = `${frames[i = ++i % frames.length]} ${description}`
        logUpdate(text)
    }, cliSpinners.dots.interval)
    try {
        await job()
        clearInterval(spinnerInterval)
        logUpdate.clear()
        return successHandler()
    } catch (e) {
        clearInterval(spinnerInterval)
        logUpdate.clear()
        return errorHandler(e)
    }
}
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

// process.exit(await spinnerJob('Publishing', async () => {
//     // await execa('npm', ['publish'], {cwd: distroDir})
//     await execa('npm', ['publish'], {cwd: distroDir, stdio: 'inherit'})
// }, () => {
//     console.info(chalk.green(`Version ${distroPackageJson.version} has been successfully published`))
//     return 0
// }, (e) => {
//     console.info(`${chalk.red('The publication encountered an error and failed to be published:')}\n${chalk.red(e.message)}`)
//     return 1
// }))
