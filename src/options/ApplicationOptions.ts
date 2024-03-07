import {ModuleOptions} from './ModuleOptions.js'
import {Expect} from '../decorators/dto/Expect.js'
import {DTO} from '../lib/core/DTO.js'

export class ApplicationOptions extends ModuleOptions {
    @Expect(DTO.String())
    dd?:any//TODO test only
}
