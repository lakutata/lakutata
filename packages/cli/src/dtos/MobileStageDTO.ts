import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class MobileStageDTO extends DTO {
    @Expect(DTO.String().valid('android', 'ios', 'harmony').required().description('The system the Node.js project is made for: android, ios or harmony'))
    public platform: 'android' | 'ios' | 'harmony'

    @Expect(DTO.Boolean().optional().default(true).description('Minify the bundle (true by default)'))
    public minify: boolean

    @Expect(DTO.String().optional().description('The architectures of Android the native addons are built for, separated by commas (arm64-v8a,x86_64); those of the libnode by default'))
    public abis?: string
}
