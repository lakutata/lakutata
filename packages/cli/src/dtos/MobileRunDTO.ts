import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class MobileRunDTO extends DTO {
    @Expect(DTO.String().valid('android', 'ios').required().description('The system: android (an emulator or a device, through npx cap run android) or ios (a simulator, built with xcodebuild)'))
    public platform: 'android' | 'ios'

    @Expect(DTO.String().optional().description('The emulator or the device of Android (its serial or the name of its AVD, npx cap run android --list), the simulator of iOS (its UDID or its name, xcrun simctl list devices); for iOS, the one running, else the newest iPhone, by default'))
    public device?: string
}
