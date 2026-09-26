import {Provider} from '@lakutata/core'
import {Accept} from '@lakutata/core/decorator/dto'
import {DateObjectDTO} from '../dto/DateObjectDTO.js'

export class TestProvider4 extends Provider{

    @Accept(DateObjectDTO.required())
    public async test4(data:DateObjectDTO){
        console.log(data.start)
    }
}