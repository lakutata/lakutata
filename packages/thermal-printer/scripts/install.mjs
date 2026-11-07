// The build of the addon when the package is installed: macOS and Windows only (USB printers, the spooler of Windows);
// Linux and the mobile systems have no addon, so nothing is compiled there and no compiler is needed. A failed build
// fails the installation.
//
// Run by npm (the install script)

import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'

if (process.platform === 'darwin' || process.platform === 'win32') {
    const gyp = process.env.npm_config_node_gyp || createRequire(import.meta.url).resolve('node-gyp/bin/node-gyp.js')
    const built = spawnSync(process.execPath, [gyp, 'rebuild'], {stdio: 'inherit'})
    process.exit(built.status ?? 1)
}
