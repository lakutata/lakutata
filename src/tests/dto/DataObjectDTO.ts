import {DTO} from '../../lib/core/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {DataFieldDTO} from './DataFieldDTO.js'

export class DataObjectDTO extends DTO {

    @Expect(DTO.String().allow('object').only().required())
    public type: 'object'

    // @Expect(DTO.Object().pattern(DTO.String(), DTO.Alternatives(DataObjectDTO.SelfLink(), DataFieldDTO.Schema())).required())
    // @Expect(DTO.Object().pattern(DTO.String(), DTO.Alternatives(DTO.Link('/'), DataFieldDTO.Schema())).required())
    @Expect(DTO.Object().pattern(DTO.String(), DTO.Alternatives(DTO.Link('....'), DataFieldDTO.Schema())).required())
    public properties: Record<string, DataObjectDTO | DataFieldDTO>
}