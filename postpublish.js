import * as fs from 'fs'

fs.writeFileSync(`postpublish${Date.now()}.log`, 'postpublish')
