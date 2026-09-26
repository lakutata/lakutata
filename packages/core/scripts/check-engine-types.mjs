/**
 * Type strictness gate for the validation engine (src/lib/validation/engine).
 *
 * 1. Type-checks the engine with noImplicitAny (the project keeps it off).
 * 2. Rejects every explicit `any` unless the same or the previous line carries
 *    an `any-justified: <reason>` comment.
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const engineDir = path.join(packageDir, 'src', 'lib', 'validation', 'engine')

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, out)
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full)
    }
    return out
}

const configFile = ts.readConfigFile(path.join(packageDir, 'tsconfig.json'), ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageDir)
const engineFiles = walk(engineDir)
const program = ts.createProgram(engineFiles, {
    ...parsed.options,
    noEmit: true,
    strict: true,
    noImplicitAny: true,
    noImplicitThis: true,
    useUnknownInCatchVariables: true
})
const problems = []

//1. Diagnostics of engine files
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (!diagnostic.file || !diagnostic.file.fileName.startsWith(engineDir)) continue
    const {line} = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    problems.push(`${path.relative(packageDir, diagnostic.file.fileName)}:${line + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
}

//2. Explicit any
for (const fileName of engineFiles) {
    const sourceFile = program.getSourceFile(fileName)
    const lines = sourceFile.text.split('\n')
    const visit = (node) => {
        if (node.kind === ts.SyntaxKind.AnyKeyword) {
            const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            const justified = /any-justified:\s*\S/.test(lines[line]) || (line > 0 && /any-justified:\s*\S/.test(lines[line - 1]))
            if (!justified) problems.push(`${path.relative(packageDir, fileName)}:${line + 1} explicit any without an "any-justified: <reason>" comment`)
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
}

for (const problem of problems) console.error(problem)
if (problems.length) {
    console.error(`\nEngine type check failed: ${problems.length} problem(s).`)
    process.exit(1)
}
console.log(`Engine type check passed (${engineFiles.length} files).`)
