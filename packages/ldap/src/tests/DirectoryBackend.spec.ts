import {rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {after} from 'node:test'
import {directorySuite} from './support/DirectorySuite.js'

//A file, so that the servers of a test share it (each connection to :memory: has a database of its own)
const file: string = join(tmpdir(), `lakutata-ldap-directory-${process.pid}.sqlite`)
rmSync(file, {force: true})
after(() => rmSync(file, {force: true}))

directorySuite('SQLite', async () => ({type: 'better-sqlite3', database: file}))
