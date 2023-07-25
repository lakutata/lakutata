import {Application} from '../Core.js'
import {Validator} from '../Core.js'

(async () => {
    await new Application().test()

    const sch = Validator.Object()
})()
