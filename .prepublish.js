import {readFile, writeFile} from 'fs/promises'

const target = 'package.json'
const backup = '.package.json.bak'

const originPkgJson = JSON.parse(await readFile(target, {encoding: 'utf-8'}))
await writeFile(backup, JSON.stringify(originPkgJson), {encoding: 'utf-8'})

delete originPkgJson['release-it']
delete originPkgJson['devDependencies']
const scriptNames = Object.keys(originPkgJson.scripts)
for (const scriptName of scriptNames) {
    if (!/publish/.test(scriptName)) delete originPkgJson.scripts[scriptName]
}
await writeFile(target, JSON.stringify(originPkgJson, null, 2), {encoding: 'utf-8', flag: 'w+'})
