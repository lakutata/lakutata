(async () => {
    const path = require('node:path')
    const vendorDir = path.resolve(__dirname, '../vendor')
    await require('./build-ffi.js')(vendorDir)
})()
