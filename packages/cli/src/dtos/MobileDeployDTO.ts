import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class MobileDeployDTO extends DTO {
    @Expect(DTO.String().valid('android', 'ios').required().description('The system: android (an emulator or a device, the debug build of the application) or ios (a simulator)'))
    public platform: 'android' | 'ios'

    @Expect(DTO.String().required().description('The id of the application (the appId of capacitor.config)'))
    public appId: string

    @Expect(DTO.String().required().description('The directory of the Node.js project made: nodejs in the web directory of Capacitor (../ui/dist/nodejs)'))
    public outdir: string

    @Expect(DTO.String().optional().description('The emulator or the device of Android (its serial, adb devices), the simulator of iOS (its UDID or its name, xcrun simctl list); the one running by default'))
    public device?: string

    @Expect(DTO.Boolean().optional().default(false).description('Watch the files of the application: when they change, run its build script (npm run build) and deploy it again, until Ctrl+C'))
    public watch: boolean

    @Expect(DTO.String().optional().default('nodejs').description('The directory of the Node.js project in the web directory of the application (the nodeDir of the plugin)'))
    public nodeDir: string
}
