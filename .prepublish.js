(async () => {
    const fsPromise = require('fs/promises')

    const target = 'package.json'
    const backup = '.package.json.bak'

    const originPkgJson = JSON.parse(await fsPromise.readFile(target, {encoding: 'utf-8'}))
    await fsPromise.writeFile(backup, JSON.stringify(originPkgJson), {encoding: 'utf-8'})

    delete originPkgJson['release-it']
    delete originPkgJson['devDependencies']
    const scriptNames = Object.keys(originPkgJson.scripts)
    for (const scriptName of scriptNames) {
        if (/release|test/.test(scriptName)) delete originPkgJson.scripts[scriptName]
    }
    await fsPromise.writeFile(target, JSON.stringify(originPkgJson, null, 2), {encoding: 'utf-8', flag: 'w+'})
})()
