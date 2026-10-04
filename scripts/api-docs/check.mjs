// The documentation of the public API (CONTRIBUTING.md, "Documenting the public API"): the declarations exported by the
// barrels of the library packages (src/exports/*.ts) and their public and protected members documented, the @param of
// their parameters, the @example of the classes and the functions; the READMEs of the packages and their sections. The
// @example of the declarations are compiled against the built typings (npm run build first).
// The declarations not documented yet are listed in baseline.json: a new one fails the check, and so does one documented
// since (--update removes it).
//
// Run: node scripts/api-docs/check.mjs [--update] [--package core] [--report] [--skip-examples]

import {mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PACKAGES = path.join(ROOT, 'packages')
const BASELINE = fileURLToPath(new URL('./baseline.json', import.meta.url))
const EXAMPLES = path.join(ROOT, 'consumer-fixture', '.examples')
const README_SECTIONS = ['## Installation', '## Usage', '## API']

const {values: args} = parseArgs({
    options: {
        update: {type: 'boolean', default: false},
        package: {type: 'string', multiple: true},
        report: {type: 'boolean', default: false},
        'skip-examples': {type: 'boolean', default: false}
    }
})

/**
 * The library packages: the ones with export barrels
 */
const packages = readdirSync(PACKAGES)
    .filter(name => existsSync(path.join(PACKAGES, name, 'src', 'exports')))
    .filter(name => !args.package || args.package.includes(name))
    .sort()

/**
 * The JSDoc blocks of a declaration (the one of its statement for a variable)
 */
function Docs(node) {
    const host = ts.isVariableDeclaration(node) ? node.parent.parent : node
    return ts.getJSDocCommentsAndTags(host).filter(doc => ts.isJSDoc(doc))
}

function Text(comment) {
    if (!comment) return ''
    return typeof comment === 'string' ? comment : comment.map(part => part.text ?? '').join('')
}

/**
 * Whether a declaration has a description (the text of its JSDoc before its tags)
 */
function Described(node) {
    return Docs(node).some(doc => Text(doc.comment).trim().length > 0)
}

function Tags(node) {
    return Docs(node).flatMap(doc => doc.tags ?? [])
}

/**
 * The function-like node of a declaration: a function, a method, or a variable holding an arrow or a function
 */
function Callable(node) {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return node
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.initializer
    return undefined
}

/**
 * The parameters without their @param (with a description)
 */
function MissingParams(node, callable) {
    const documented = new Map(Tags(node).filter(tag => ts.isJSDocParameterTag(tag)).map(tag => [tag.name.getText(), Text(tag.comment).trim()]))
    const missing = []
    callable.parameters.forEach((parameter, index) => {
        if (ts.isIdentifier(parameter.name)) {
            if (parameter.name.text === 'this') return
            if (!documented.get(parameter.name.text)) missing.push(parameter.name.text)
        } else if (![...documented.values()][index]) {
            //A destructured parameter: its @param, whatever its name
            missing.push(`#${index}`)
        }
    })
    return missing
}

/**
 * The overloads of a function or a method: the implementation is not documented when there are overloads
 */
function Signatures(declarations) {
    const withBody = declarations.filter(declaration => declaration.body)
    return declarations.length > 1 && withBody.length ? declarations.filter(declaration => !declaration.body) : declarations
}

/**
 * The members of a type: the ones of its literals, intersections and unions
 */
function TypeMembers(type) {
    if (!type) return []
    if (ts.isTypeLiteralNode(type)) return [...type.members]
    if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)) return type.types.flatMap(TypeMembers)
    if (ts.isParenthesizedTypeNode(type)) return TypeMembers(type.type)
    return []
}

function MemberName(member) {
    if (!member.name) return undefined
    if (ts.isPrivateIdentifier(member.name) || ts.isComputedPropertyName(member.name)) return undefined
    return member.name.getText().replace(/^['"]|['"]$/g, '')
}

/**
 * The violations of a package, by key
 */
function Audit(pkg) {
    const directory = path.join(PACKAGES, pkg)
    const sources = path.join(directory, 'src')
    const barrels = readdirSync(path.join(sources, 'exports')).filter(file => file.endsWith('.ts')).map(file => path.join(sources, 'exports', file))
    const config = ts.getParsedCommandLineOfConfigFile(path.join(directory, 'tsconfig.json'), {}, {...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined})
    const program = ts.createProgram(barrels, config.options)
    const checker = program.getTypeChecker()
    const own = declaration => declaration.getSourceFile().fileName.startsWith(sources + path.sep) && !declaration.getSourceFile().fileName.includes(`${path.sep}tests${path.sep}`)
    const violations = new Map()
    const examples = []
    const seen = new Set()
    const report = (key, file) => violations.set(key, path.relative(ROOT, file))

    for (const barrel of barrels) {
        const module = checker.getSymbolAtLocation(program.getSourceFile(barrel))
        if (!module) continue
        for (let symbol of checker.getExportsOfModule(module)) {
            if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
            const declarations = (symbol.declarations ?? []).filter(own)
            if (!declarations.length || seen.has(symbol)) continue
            seen.add(symbol)
            const name = symbol.name
            const file = declarations[0].getSourceFile().fileName
            const callables = declarations.filter(Callable)
            const isClass = declarations.some(ts.isClassDeclaration)
            //The description: on one of its declarations (an overload, the merged ones)
            if (!declarations.some(Described)) report(`${pkg}: ${name}: description`, file)
            //The example of the classes and the functions, not of the exceptions
            const tags = declarations.flatMap(Tags)
            for (const tag of tags.filter(tag => tag.tagName.text === 'example')) examples.push({pkg, name, text: Text(tag.comment), file})
            if ((isClass || callables.length) && !name.endsWith('Exception') && !tags.some(tag => tag.tagName.text === 'example')) report(`${pkg}: ${name}: @example`, file)
            //The parameters of the functions
            for (const declaration of Signatures(callables)) {
                if (!Docs(declaration).length) continue
                for (const parameter of MissingParams(declaration, Callable(declaration))) report(`${pkg}: ${name}: @param ${parameter}`, file)
            }
            //The members
            const members = new Map()
            for (const declaration of declarations) {
                let list = []
                if (ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) list = [...declaration.members]
                else if (ts.isTypeAliasDeclaration(declaration)) list = TypeMembers(declaration.type)
                else if (ts.isEnumDeclaration(declaration)) list = [...declaration.members]
                for (const member of list) {
                    if (ts.isConstructorDeclaration(member) || ts.isClassStaticBlockDeclaration(member) || ts.isIndexSignatureDeclaration(member)) continue
                    const flags = ts.getCombinedModifierFlags(member)
                    if (flags & ts.ModifierFlags.Private) continue
                    const memberName = MemberName(member)
                    if (!memberName) continue
                    if (!members.has(memberName)) members.set(memberName, [])
                    members.get(memberName).push(member)
                }
            }
            //The members overriding the ones of a base class are documented by it
            const inherited = new Set()
            if (declarations.some(declaration => ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration))) {
                const type = checker.getDeclaredTypeOfSymbol(symbol)
                for (const base of checker.getBaseTypes(type) ?? []) for (const property of base.getProperties()) inherited.add(property.name)
            }
            for (const [memberName, nodes] of members) {
                if (inherited.has(memberName)) continue
                if (!nodes.some(Described)) report(`${pkg}: ${name}.${memberName}: description`, file)
                for (const node of Signatures(nodes.filter(Callable))) {
                    if (!Docs(node).length) continue
                    for (const parameter of MissingParams(node, Callable(node))) report(`${pkg}: ${name}.${memberName}: @param ${parameter}`, file)
                }
            }
        }
    }

    //The README
    const readme = path.join(directory, 'README.md')
    if (!existsSync(readme)) {
        report(`${pkg}: README.md`, readme)
    } else {
        const content = readFileSync(readme, 'utf8')
        for (const section of README_SECTIONS) if (!content.split('\n').some(line => line.trim() === section)) report(`${pkg}: README.md ${section}`, readme)
    }
    return {violations, examples}
}

/**
 * Compile the examples against the built typings
 */
function CompileExamples(examples) {
    rmSync(EXAMPLES, {recursive: true, force: true})
    if (!examples.length) return []
    mkdirSync(EXAMPLES, {recursive: true})
    const files = new Map()
    examples.forEach((example, index) => {
        const fenced = /```(?:typescript|ts)\s*\n([\s\S]*?)```/.exec(example.text)
        const code = fenced ? fenced[1] : example.text
        const file = path.join(EXAMPLES, `${example.pkg}-${example.name}-${index}.ts`)
        //A module of its own: its declarations do not clash with the other examples
        writeFileSync(file, `${code}\nexport {}\n`)
        files.set(file, example)
    })
    const fixture = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, 'consumer-fixture', 'tsconfig.json'), {}, {...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined})
    const program = ts.createProgram([...files.keys()], {...fixture.options, types: ['node'], noEmit: true, noUnusedLocals: false})
    const errors = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file && files.has(diagnostic.file.fileName))
    return errors.map(diagnostic => {
        const example = files.get(diagnostic.file.fileName)
        const {line} = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        return `${example.pkg}: ${example.name}: the @example does not compile (line ${line + 1}): ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')} (${path.relative(ROOT, example.file)})`
    })
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
const current = {}
const examples = []
for (const pkg of packages) {
    const result = Audit(pkg)
    current[pkg] = result.violations
    examples.push(...result.examples)
}

if (args.report) {
    for (const pkg of packages) {
        const keys = [...current[pkg].keys()]
        const count = rule => keys.filter(key => key.endsWith(rule) || key.includes(rule)).length
        console.log(`${pkg.padEnd(12)} ${String(keys.length).padStart(5)} undocumented: ${count(': description')} descriptions, ${count('@param')} @param, ${count('@example')} @example, ${count('README')} README`)
    }
    process.exit(0)
}

if (args.update) {
    const next = {...baseline}
    for (const pkg of packages) {
        const keys = [...current[pkg].keys()].sort()
        if (keys.length) next[pkg] = keys
        else delete next[pkg]
    }
    writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 2)}\n`)
    console.log(`The baseline lists ${Object.values(next).flat().length} undocumented declarations.`)
}

const failures = []
for (const pkg of packages) {
    const listed = new Set(args.update ? [...current[pkg].keys()] : baseline[pkg] ?? [])
    for (const [key, file] of current[pkg]) if (!listed.has(key)) failures.push(`${key} is not documented (${file})`)
    for (const key of listed) if (!current[pkg].has(key)) failures.push(`${key} is documented now: remove it from the baseline (node scripts/api-docs/check.mjs --update)`)
}
if (!args['skip-examples']) failures.push(...CompileExamples(examples))

if (failures.length) {
    console.error(failures.join('\n'))
    console.error(`\n${failures.length} problems in the documentation of the public API (CONTRIBUTING.md, "Documenting the public API").`)
    process.exit(1)
}
const remaining = packages.reduce((total, pkg) => total + current[pkg].size, 0)
console.log(`The public API is documented as its baseline lists (${remaining} declarations left), its ${examples.length} examples compile.`)
