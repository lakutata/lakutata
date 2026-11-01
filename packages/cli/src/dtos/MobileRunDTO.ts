import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class MobileRunDTO extends DTO {
    @Expect(DTO.String().valid('android', 'ios', 'harmony').required().description('The system: android (an emulator or a device), ios (a simulator) or harmony (an emulator or a device)'))
    public platform: 'android' | 'ios' | 'harmony'

    @Expect(DTO.String().optional().description('The emulator or the device of Android (its serial, adb devices) or of HarmonyOS (its target, hdc list targets), the simulator of iOS (its UDID or its name, xcrun simctl list devices); the one running by default, else the newest iPhone for iOS'))
    public device?: string
}
