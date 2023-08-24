(async () => {
    const fsPromise = require('fs/promises')
    const os = require('os')

    const target = 'package.json'
    const backup = '.package.json.bak'

    const originPkgJson = JSON.parse(await fsPromise.readFile(backup, {encoding: 'utf-8'}))
    await fsPromise.writeFile(target, `${JSON.stringify(originPkgJson, null, 2)}${os.EOL}`, {
        encoding: 'utf-8',
        flag: 'w+'
    })
    await fsPromise.rm(backup, {force: true, recursive: true})
})()
