import {existsSync, mkdirSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {FFIGenerateDTO} from '../dtos/FFIGenerateDTO.js'
import {type Generator, loadGenerator} from '../lib/FFI.js'
import {done, warn} from '../lib/Output.js'

/**
 * The commands of the native libraries (@lakutata/ffi)
 */
export class FFIController extends Controller {

    @CLIAction('ffi generate <header>', FFIGenerateDTO, {description: 'Generate the class of a native library from its C header: a property by function, an interface by struct, the constants, with their TypeScript types'})
    public async generate(input: FFIGenerateDTO): Promise<undefined> {
        const generator: Generator = await loadGenerator(process.cwd())
        const {className, code, report} = await generator.generateNativeLibrary({
            header: input.header,
            library: input.library,
            className: input.className,
            include: input.include,
            define: input.define,
            own: input.own,
            compiler: input.compiler,
            check: input.check
        })
        const file: string = path.resolve(input.out ?? `${className}.ts`)
        if (existsSync(file) && !input.force) throw new Error(`${path.relative(process.cwd(), file)} exists: give --force to replace it`)
        mkdirSync(path.dirname(file), {recursive: true})
        writeFileSync(file, code)
        const count = (number: number, noun: string): string => `${number} ${noun}${number === 1 ? '' : 's'}`
        done(`Generated ${path.relative(process.cwd(), file)} (${className}): ${count(report.functions, 'function')}, ${count(report.variables, 'variable')}, ${count(report.interfaces, 'interface')}, ${count(report.constants, 'constant')}${report.library ? `, checked against ${report.library}` : ''}`)
        if (!report.library) warn(input.check ? `The functions were not checked against the library: ${report.unchecked}; give it with --library` : 'The functions were not checked against the library (--no-check)')
        if (report.skipped.length) warn(`Left out ${count(report.skipped.length, 'declaration')} of the library:`)
        for (const skipped of report.skipped) warn(`  ${skipped.name}${skipped.file ? ` (${path.relative(process.cwd(), skipped.file)}:${skipped.line})` : ''}: ${skipped.reason}`)
        return undefined
    }
}
