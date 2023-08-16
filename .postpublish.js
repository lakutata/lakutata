import {readFile, writeFile} from 'fs/promises'

const target = 'package.json'
const backup = '.package.json.bak'

const originPkgJson = JSON.parse(await readFile(target, {encoding: 'utf-8'}))
await writeFile(backup, JSON.stringify(originPkgJson), {encoding: 'utf-8'})
originPkgJson.keywords.push("test")
await writeFile(target, JSON.stringify(originPkgJson), {encoding: 'utf-8'})
