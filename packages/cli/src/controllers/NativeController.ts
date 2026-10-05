import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {NativeDTO} from '../dtos/NativeDTO.js'
import {done, warn} from '../lib/Output.js'
import {changeNative, type NativeChangeResult} from '../lib/native/NativeProject.js'

/**
 * The commands of the native addons: the libraries, the headers and the macros of their builds
 */
export class NativeController extends Controller {

    @CLIAction('native <action> <value>', NativeDTO, {description: 'Change the build of the native addon of the current directory (binding.gyp, CMakeLists.txt, Cargo.toml): link a library, include headers, define a macro'})
    public async native(input: NativeDTO): Promise<undefined> {
        const result: NativeChangeResult = await changeNative(process.cwd(), {
            action: input.action,
            value: input.value,
            platform: input.platform,
            pkgConfig: input.pkgConfig,
            framework: input.framework,
            crate: input.crate,
            target: input.target
        })
        const what: string = {link: 'Linked', include: 'Included', define: 'Defined'}[input.action]
        done(result.files.length ? `${what} ${input.value} (${result.build}): ${result.files.join(', ')}` : `${input.value} is already in the build (${result.build}): nothing changed`)
        for (const note of result.notes) warn(note)
        return undefined
    }
}
