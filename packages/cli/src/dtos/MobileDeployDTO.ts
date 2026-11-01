import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class MobileDeployDTO extends DTO {
    @Expect(DTO.String().valid('android', 'ios', 'harmony').required().description('The system: android (an emulator or a device, the debug build of the application), ios (a simulator) or harmony (an emulator or a device, the debug build of the application)'))
    public platform: 'android' | 'ios' | 'harmony'

    @Expect(DTO.String().optional().description('The emulator or the device of Android (its serial, adb devices) or of HarmonyOS (its target, hdc list targets), the simulator of iOS (its UDID or its name, xcrun simctl list); the one running by default'))
    public device?: string

    @Expect(DTO.Boolean().optional().default(false).description('Watch the files of the application: when they change, run its build script (npm run build) and deploy it again, until Ctrl+C'))
    public watch: boolean
}
