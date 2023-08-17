import {readFile, writeFile, rm} from 'fs/promises'
import {EOL} from 'os'

const target = 'package.json'
const backup = '.package.json.bak'

const originPkgJson = JSON.parse(await readFile(backup, {encoding: 'utf-8'}))
await writeFile(target, `${JSON.stringify(originPkgJson, null, 2)}${EOL}`, {encoding: 'utf-8', flag: 'w+'})
await rm(backup, {force: true, recursive: true})
