import {ModuleOptions} from './ModuleOptions.js'
import {Expect} from '../decorators/dto/Expect.js'
import {DTO} from '../lib/core/DTO.js'

export class ApplicationOptions extends ModuleOptions {

    /**
     * AppId
     */
    @Expect(DTO.String().required())
    public readonly id: string

    /**
     * AppName
     */
    @Expect(DTO.String().required())
    public readonly name: string

    /**
     * Application timezone
     */
    @Expect(DTO.String()
        .optional()
        .default('auto'))
    public readonly timezone?: string | 'auto'

    /**
     * runtime environment (development or production, default value is development)
     */
    @Expect(DTO.String()
        .valid('development', 'production')
        .optional()
        .default('development'))
    public readonly mode?: 'development' | 'production'

}
