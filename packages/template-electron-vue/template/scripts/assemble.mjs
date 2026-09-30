// The application packaged by electron-builder (release/app): the main process bundled with its dependencies (and its
// native addons next to it, unpacked from the archive), the preload script, the built renderer, and their package.json.
// Run after "npm run build" (npm run package runs both).
import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const release = path.join(root, 'release', 'app')
rmSync(path.join(root, 'release'), {recursive: true, force: true})
mkdirSync(release, {recursive: true})

//The main process bundled with its dependencies (lakutata bundle, the "bundle" script of the app): Electron is given by
//the runtime
const bundled = spawnSync('npm', ['run', 'bundle', '--workspace', 'app'], {cwd: root, stdio: 'inherit', shell: process.platform === 'win32'})
if (bundled.status !== 0) process.exit(bundled.status ?? 1)
cpSync(path.join(root, 'packages', 'app', 'build', 'preload.cjs'), path.join(release, 'preload.cjs'))
const renderer = path.join(root, 'packages', 'ui', 'dist')
if (!existsSync(path.join(renderer, 'index.html'))) throw new Error('The renderer is not built: npm run build')
cpSync(renderer, path.join(release, 'renderer'), {recursive: true})

//The package.json of the application: its information, without dependencies (they are in the bundle). The deb packages
//need the email of their maintainer (the author, "Name <email>") and a homepage
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
let author = typeof manifest.author === 'object' && manifest.author ? `${manifest.author.name} <${manifest.author.email ?? ''}>` : String(manifest.author ?? '')
if (!/<[^>]+@[^>]+>/.test(author)) {
    console.warn(`The author of package.json has no email ("Name <email>"), which the deb packages need: ${manifest.name}@localhost is given`)
    author = `${author || manifest.productName || manifest.name} <${manifest.name}@localhost>`
}
writeFileSync(path.join(release, 'package.json'), `${JSON.stringify({
    name: manifest.name,
    productName: manifest.productName,
    version: manifest.version,
    description: manifest.description || manifest.productName,
    author: author,
    homepage: manifest.homepage || 'NONE',
    //The name of the windows on Linux, which associates them with the launcher of the application
    desktopName: `${manifest.name}.desktop`,
    license: manifest.license,
    main: 'main.cjs'
}, null, 2)}\n`)
console.log(`The application is assembled in ${path.relative(process.cwd(), release) || release}`)
