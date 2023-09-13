(async () => {
    const fsPromise = require('fs/promises')
    const os = require('os')
    const path = require('path')
    const {execa} = await import('execa')
    const buildDirectory = path.resolve(__dirname, './build')
    const projectPackageJsonFilename = path.resolve(__dirname, './package.json')
    const buildPackageJsonFilename = path.resolve(buildDirectory, './package.json')
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
    //处理build文件夹内的package.json文件
    const pkgJson = JSON.parse(await fsPromise.readFile(buildPackageJsonFilename, {encoding: 'utf-8'}))
    delete pkgJson['release-it']
    delete pkgJson['devDependencies']
    delete pkgJson['scripts']
    // const scriptNames = Object.keys(pkgJson.scripts)
    // for (const scriptName of scriptNames) {
    //     // if (/release|test/.test(scriptName))
    //     delete pkgJson.scripts[scriptName]
    // }
    await fsPromise.writeFile(buildPackageJsonFilename, JSON.stringify(pkgJson, null, 2), {
        encoding: 'utf-8',
        flag: 'w+'
    })
    //执行npm发布
    await execa('npm', ['publish'], {cwd: buildDirectory})
})()
