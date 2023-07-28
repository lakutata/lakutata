import {CD} from '../decorators/ClassDecorators.js'
import {PD} from '../decorators/PropertyDecorators.js'

@(() => {
    return (target) => {
        console.log('tttttt')
    }
})()
export class Abcd {
    @PD()
    public readonly aa
}
