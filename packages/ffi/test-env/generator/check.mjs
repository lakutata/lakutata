//The classes generated from headers of the system, compiled by tsc in a project of their own, then created as components
//and called. Not a unit test (it needs the headers, the libraries and TypeScript): a check to run again when the
//generator changes.
//   npm run compile && node test-env/generator/check.mjs [--keep]
//With --keep, the project is kept (its path is written) to read the code generated.
import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {generateNativeLibrary} from '../../dist/esm/exports/Generator.js'

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ROOT = path.resolve(PACKAGE, '../..')
const INCLUDES = process.platform === 'darwin' ? path.join(execFileSync('xcrun', ['--show-sdk-path']).toString().trim(), 'usr', 'include') : '/usr/include'

//The headers, the name of their library when it is not the one of the header, a call
const HEADERS = [
    {header: 'sqlite3.h', className: 'Sqlite3', call: 'sqlite3_libversion()'},
    {header: 'zlib.h', library: 'z', className: 'Zlib', call: 'zlibVersion()'},
    {header: 'pcap/pcap.h', className: 'Pcap', call: 'pcap_lib_version()'},
    {header: 'curl/curl.h', className: 'Curl', call: 'curl_version()'}
]

const project = mkdtempSync(path.join(tmpdir(), 'lakutata-ffi-generated-'))
try {
    mkdirSync(path.join(project, 'src'))
    mkdirSync(path.join(project, 'node_modules', '@lakutata'), {recursive: true})
    mkdirSync(path.join(project, 'node_modules', '@types'), {recursive: true})
    symlinkSync(path.join(ROOT, 'packages', 'lakutata'), path.join(project, 'node_modules', 'lakutata'), 'junction')
    symlinkSync(PACKAGE, path.join(project, 'node_modules', '@lakutata', 'ffi'), 'junction')
    symlinkSync(path.join(ROOT, 'node_modules', '@types', 'node'), path.join(project, 'node_modules', '@types', 'node'), 'junction')
    writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'generated', type: 'module'}))
    writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', outDir: 'build', rootDir: 'src', strict: true, experimentalDecorators: true,
            emitDecoratorMetadata: true, useDefineForClassFields: false, strictPropertyInitialization: false, skipLibCheck: true, types: ['node']
        },
        include: ['src']
    }))
    const generated = []
    for (const {header, library, className, call} of HEADERS) {
        const file = path.join(INCLUDES, header)
        if (!existsSync(file)) {
            console.log(`${header}: not installed`)
            continue
        }
        const started = performance.now()
        const {code, report} = await generateNativeLibrary({header: file, library: library, className: className})
        const name = path.basename(header, '.h')
        writeFileSync(path.join(project, 'src', `${name}.ts`), code)
        console.log(`${header}: ${report.functions} functions, ${report.variables} variables, ${report.interfaces} interfaces, ${report.constants} constants, ${report.skipped.length} left out (${[...new Set(report.skipped.map(skipped => skipped.reason.slice(0, 40)))].join('; ') || 'none'}), checked against ${report.library ?? `nothing: ${report.unchecked}`}, ${(performance.now() - started).toFixed(0)} ms`)
        generated.push({name, className, call})
    }
    writeFileSync(path.join(project, 'src', 'main.ts'), [
        'import {Container} from \'lakutata\'',
        ...generated.map(({name, className}) => `import {${className}} from './${name}.js'`),
        'const container: Container = new Container()',
        ...generated.flatMap(({name, className, call}) => [
            `await container.setNamed('${name}', ${className}, {})`,
            `console.log('${name}:', (await container.get<${className}>('${name}')).${call})`
        ]),
        'await container.destroy()'
    ].join('\n'))
    execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', project], {stdio: 'inherit'})
    console.log('compiled by tsc')
    execFileSync(process.execPath, [path.join(project, 'build', 'main.js')], {stdio: 'inherit'})
} finally {
    if (process.argv.includes('--keep')) console.log(`kept: ${project}`)
    else rmSync(project, {recursive: true, force: true})
}
