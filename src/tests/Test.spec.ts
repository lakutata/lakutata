import {Application} from '../Core.js'
import {Validator} from '../Core.js'

(async () => {
    await new Application().test({a:'222',b:'dddddd',dd:11},'11',true)
})()
