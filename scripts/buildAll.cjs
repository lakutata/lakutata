const fs = require('fs')
const path = require('node:path')
fs.writeFileSync(path.resolve(__dirname, '../test.log'), 'hahahahahaha', {encoding: 'utf-8'})
