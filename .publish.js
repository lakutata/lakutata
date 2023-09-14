import fsPromise from 'fs/promises'
import path from 'path'

(async () => {
    const fsPromise = require('fs/promises')
    const path = require('path')
    const cliSpinners = require('cli-spinners')
    const logUpdate = (await import('log-update')).default
    const chalk = (await import('chalk')).default
    const {execa} = await import('execa')
    const buildDirectory = path.resolve(__dirname, './build')
    const projectPackageJsonFilename = path.resolve(__dirname, './package.json')
    const buildPackageJsonFilename = path.resolve(buildDirectory, './package.json')
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
    //复制package.json至build文件夹
    await fsPromise.cp(projectPackageJsonFilename, buildPackageJsonFilename, {
        recursive: true,
        force: true
    })
    //复制LICENSE至build文件夹
    await fsPromise.cp(path.resolve(__dirname, './LICENSE'), path.resolve(buildDirectory, './LICENSE'), {
        recursive: true,
        force: true
    })
    //复制README.md至build文件夹
    await fsPromise.cp(path.resolve(__dirname, './README.md'), path.resolve(buildDirectory, './README.md'), {
        recursive: true,
        force: true
    })
    //处理build文件夹内的package.json文件
    const pkgJson = JSON.parse(await fsPromise.readFile(buildPackageJsonFilename, {encoding: 'utf-8'}))
    delete pkgJson['release-it']
    delete pkgJson['devDependencies']
    delete pkgJson['scripts']
    await fsPromise.writeFile(buildPackageJsonFilename, JSON.stringify(pkgJson, null, 2), {
        encoding: 'utf-8',
        flag: 'w+'
    })
    //执行npm发布
    const exitCode = await spinnerJob('Publishing', async () => {
        await execa('npm', ['publish'], {cwd: buildDirectory})
    }, () => {
        console.info(chalk.green(`Version ${pkgJson.version} has been successfully published`))
        return 0
    }, (e) => {
        console.info(`${chalk.red('The publication encountered an error and failed to be published:')}\n${chalk.red(e.message)}`)
        return 1
    })
    process.exit(exitCode)
})()
