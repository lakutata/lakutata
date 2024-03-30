/**
 * Build FFI binary for current platform
 * @param vendorDir
 * @return {Promise<unknown>}
 */
async function buildFfi(vendorDir) {
    const {fork} = require('node:child_process')
    const path = require('node:path')
    const fs = require('fs')
    const ffiDir = path.resolve(__dirname, '../cpp/ffi')
    return new Promise((resolve, reject) => {
        fork(path.resolve(__dirname, './tools/cnoke/cnoke.js'), {
            cwd: ffiDir
        }).on('exit', code => {
            if (code !== 0) return reject(new Error('FFI build failed!'))
            fs.cp(
                path.resolve(ffiDir, './build/ffi.node'),
                path.resolve(vendorDir, './ffi.node'), {force: true},
                err => err ? reject(err) : resolve())
        })
    })
}

module.exports = buildFfi
