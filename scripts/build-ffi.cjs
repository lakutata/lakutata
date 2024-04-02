/**
 * Build FFI binary for current platform
 * @param vendorDir
 * @return {Promise<unknown>}
 */
async function buildFfi(vendorDir) {
    const {fork} = require('node:child_process')
    const {readFile, mkdir, cp, readdir} = require('node:fs/promises')
    const path = require('node:path')
    const {homedir} = require('node:os')
    const ffiDir = path.resolve(__dirname, '../cpp/ffi')
    const ffiPkgJson = JSON.parse(await readFile(path.resolve(__dirname, '../cpp/ffi/pkg.json'), {encoding: 'utf-8'}))
    const cacheDir = path.resolve(homedir(), './.ffi-cache')
    await mkdir(cacheDir, {recursive: true})
    const files = await readdir(cacheDir)
    const cached = files.map(file => {
        const basename = path.basename(file, '.node')
        const version = basename.split('_')[1]
        if (version === ffiPkgJson.version) return file
        return null
    }).filter(file => !!file)[0]
    if (cached) return await cp(path.resolve(cacheDir, cached), path.resolve(vendorDir, './ffi.node'), {force: true})
    return new Promise((resolve, reject) => {
        fork(path.resolve(__dirname, './tools/cnoke/cnoke.js'), {
            cwd: ffiDir
        }).on('exit', code => {
            if (code !== 0) return reject(new Error('FFI build failed!'))
            Promise
                .all([
                    new Promise((toVendorResolve, toVendorReject) => cp(path.resolve(ffiDir, './build/ffi.node'), path.resolve(vendorDir, './ffi.node'), {force: true}).then(toVendorResolve).catch(toVendorReject)),
                    cacheDir ? new Promise((toCacheResolve, toCacheReject) => cp(path.resolve(ffiDir, './build/ffi.node'), path.resolve(cacheDir, `./ffi_${ffiPkgJson.version}.node`), {force: true}).then(toCacheResolve).catch(toCacheReject)) : undefined
                ])
                .then(resolve)
                .catch(reject)
        })
    })
}

module.exports = buildFfi
