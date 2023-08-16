import * as fs from 'fs'

fs.writeFileSync(`prepublishOnly${Date.now()}.log`, 'prepublishOnly')
