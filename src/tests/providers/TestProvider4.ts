import {Provider} from '../../lib/core/Provider.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {DateObjectDTO} from '../dto/DateObjectDTO.js'

export class TestProvider4 extends Provider{

    @Accept(DateObjectDTO.required())
    public async test4(data:DateObjectDTO){
        console.log(data.start)
    }
}