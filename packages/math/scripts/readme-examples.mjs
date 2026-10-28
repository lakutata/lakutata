//The examples of the READMEs run: each TypeScript block transpiled, its import of @lakutata/math taken from dist/, the
//value of each console.log() with a comment compared with the comment (blanks aside; a prefix where the comment ends
//with …), a statement whose comment names an exception required to throw it with that message. Run it after
//npm run build:js: node scripts/readme-examples.mjs
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {format} from 'node:util'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = pathToFileURL(join(root, 'dist/esm/exports/Math.js')).href
const problems = []
let checked = 0

//Blanks aside, the lengths of typed arrays aside (Float64Array(2) [1, 1] as Float64Array [1, 1])
const normalized = text => text.replace(/\s+/g, '').replace(/"/g, '\'').replace(/(\w+Array)\(\d+\)/g, '$1')
const NUMBER = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi
//Equal but for the last digits of the numbers (1e-12 relative): doubles of other platforms and versions
const close = (got, wanted) => {
    if (got.replace(NUMBER, '#') !== wanted.replace(NUMBER, '#')) return false
    const a = got.match(NUMBER) ?? [], b = wanted.match(NUMBER) ?? []
    return a.every((value, i) => Math.abs(Number(value) - Number(b[i])) <= 1e-12 * Math.max(1, Math.abs(Number(b[i]))))
}
//A comment that describes the value in words (five dice, of the seed 42; in Chinese too), not its text
const prose = comment => /[\u4e00-\u9fff]/.test(comment) || (/^[A-Za-z][A-Za-z0-9 ,]* [A-Za-z0-9 ,]+$/.test(comment) && !/^(true|false|null|undefined|NaN|Infinity)( |$)/.test(comment))

globalThis.__check = (where, values, expected) => {
    checked++
    const actual = format(...values)
    const truncated = expected.endsWith('…')
    const wanted = normalized(truncated ? expected.slice(0, -1) : expected)
    const got = normalized(actual)
    if (truncated ? !got.startsWith(wanted) : !close(got, wanted)) problems.push(`${where}: ${actual}, not ${expected}`)
}

globalThis.__throws = async (where, statement, name, message) => {
    checked++
    try {
        await statement()
        problems.push(`${where}: no ${name}`)
    } catch (error) {
        if (error?.constructor?.name !== name) problems.push(`${where}: ${error?.constructor?.name} ${error?.message}, not ${name}`)
        else if (message && !error.message.startsWith(message.replace(/…$/, ''))) problems.push(`${where}: ${error.message}, not ${message}`)
    }
}

for (const file of ['README.md', 'README.zh-CN.md']) {
    const text = readFileSync(join(root, file), 'utf8')
    const blocks = [...text.matchAll(/```typescript\n([\s\S]*?)```/g)]
    for (const block of blocks) {
        const firstLine = text.slice(0, block.index).split('\n').length + 1
        const lines = block[1].split('\n').map((line, index) => {
            const where = `${file}:${firstLine + index}`
            if (/from '@lakutata\/math'/.test(line)) return line.replace('\'@lakutata/math\'', `'${entry}'`)
            const logged = /^(\s*)console\.log\((.*)\)\s*\/\/(.*)$/.exec(line)
            if (logged && prose(logged[3].trim())) return line
            if (logged) return `${logged[1]}__check(${JSON.stringify(where)}, [${logged[2]}], ${JSON.stringify(logged[3].trim())})`
            const thrown = /^(\s*)(.*?)\s*\/\/(Math\w*Exception)(?::\s*(.*))?$/.exec(line)
            if (thrown) return `${thrown[1]}await __throws(${JSON.stringify(where)}, async () => { ${thrown[2]} }, ${JSON.stringify(thrown[3])}, ${JSON.stringify(thrown[4] ?? '')})`
            return line
        })
        const javascript = ts.transpileModule(lines.join('\n'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText
        try {
            await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)
        } catch (error) {
            problems.push(`${file}:${firstLine}: the block throws ${error?.constructor?.name}: ${error?.message}`)
        }
    }
}
console.log(`${checked} results checked`)
for (const problem of problems) console.log(problem)
process.exit(problems.length === 0 ? 0 : 1)
