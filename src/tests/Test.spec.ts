import {Application} from '../Core.js'
import {Validator} from '../Core.js'

(async () => {
    await new Application().test({a:'222'},'11',true)
})()
