import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class MobileNodeDTO extends DTO {
    @Expect(DTO.String().valid('android', 'ios', 'harmony').required().description('The system the libnode is built for: android, ios or harmony'))
    public platform: 'android' | 'ios' | 'harmony'

    @Expect(DTO.String().optional().description('The architectures of Android built for, separated by commas (arm64-v8a,armeabi-v7a,x86_64); arm64-v8a,x86_64 by default'))
    public abis?: string

    @Expect(DTO.Number().integer().min(1).max(64).optional().description('The jobs of make; by default, those the memory of Docker allows'))
    public jobs?: number
}
