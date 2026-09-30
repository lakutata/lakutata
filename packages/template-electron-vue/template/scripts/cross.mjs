// Package the application for Linux in a container of the architecture (docker run --platform linux/<arch>, emulated by
// QEMU when it is not the one of the machine): the project is copied into the image (Dockerfile), installed and packaged
// there, the packages are copied to release/cross/<arch>. The native addons are built in the container, for the
// architecture. Windows and macOS are packaged on them.
// Run: npm run cross [-- linux/arm64 linux/amd64]
import {spawnSync} from 'node:child_process'
import {mkdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const platforms = process.argv.slice(2).length ? process.argv.slice(2) : ['linux/arm64']
const name = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name

/**
 * Run docker, stop at its failure
 * @param args
 */
function Docker(args) {
    const result = spawnSync('docker', args, {cwd: root, stdio: 'inherit'})
    if (result.status !== 0) process.exit(result.status ?? 1)
}

for (const platform of platforms) {
    if (!/^linux\/[\w/]+$/.test(platform)) {
        console.error(`${platform}: the cross builds are the ones of Linux (linux/amd64, linux/arm64…); Windows and macOS are packaged on them`)
        process.exit(1)
    }
    const arch = platform.split('/').slice(1).join('-')
    const image = `${name}-cross:${arch}`
    const output = path.join(root, 'release', 'cross', arch)
    mkdirSync(output, {recursive: true})
    console.log(`\nPackage for ${platform}`)
    Docker(['build', '--platform', platform, '--tag', image, '.'])
    Docker(['run', '--rm', '--platform', platform, '--volume', `${output}:/output`, image])
    Docker(['image', 'rm', image])
    console.log(`The packages of ${platform}: ${path.relative(process.cwd(), output)}`)
}
