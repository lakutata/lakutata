import {readFile} from 'node:fs/promises'
import {applyEdits, indentUnit, lineEndOf, lineIndent, NativeSyntaxError, type TextEdit} from './TextEdits.js'

/**
 * An argument of a command of CMake: bracket ([=[…]=]), quoted ("…") or unquoted, with its place in the text
 */
export type CMakeArgument = {
    kind: 'bracket' | 'quoted' | 'unquoted'
    /**
     * Its value (the escapes of the quoted arguments resolved)
     */
    value: string
    start: number
    end: number
}

/**
 * A command invocation of CMake (cmake-language(7)): name(arguments), with its place in the text and its depth in the
 * blocks (if, foreach, while, function, macro, block)
 */
export type CMakeCommand = {
    name: string
    args: CMakeArgument[]
    start: number
    end: number
    depth: number
}

/**
 * The blocks of CMake, by their opening command
 */
const BLOCKS: Record<string, string> = {if: 'endif', foreach: 'endforeach', while: 'endwhile', function: 'endfunction', macro: 'endmacro', block: 'endblock'}

/**
 * The parser of the files of CMake, by the grammar of cmake-language(7): the command invocations, their bracket, quoted
 * and unquoted arguments (the parentheses nested), the line and the bracket comments
 */
class CMakeParser {
    protected offset: number = 0

    constructor(protected readonly file: string, protected readonly text: string) {
    }

    protected error(message: string, offset: number = this.offset): never {
        throw new NativeSyntaxError(this.file, this.text, offset, message)
    }

    /**
     * The length of the bracket opening at an offset ([==[: its = counted), -1 when there is none
     * @param offset
     */
    protected bracketLevel(offset: number): number {
        if (this.text[offset] !== '[') return -1
        let end: number = offset + 1
        while (this.text[end] === '=') end++
        return this.text[end] === '[' ? end - offset - 1 : -1
    }

    /**
     * Skip a bracket ([=[…]=]) at the offset, return its content
     */
    protected bracket(): string {
        const start: number = this.offset
        const level: number = this.bracketLevel(this.offset)
        const close: string = `]${'='.repeat(level)}]`
        const contentStart: number = this.offset + level + 2
        const end: number = this.text.indexOf(close, contentStart)
        if (end < 0) this.error('unterminated bracket', start)
        this.offset = end + close.length
        //The newline right after the opening bracket is not part of its content
        return this.text.slice(contentStart, end).replace(/^\r?\n/, '')
    }

    /**
     * Skip a comment at the offset (#…, #[[…]])
     */
    protected comment(): void {
        this.offset++
        if (this.bracketLevel(this.offset) >= 0) {
            this.bracket()
        } else {
            while (this.offset < this.text.length && this.text[this.offset] !== '\n') this.offset++
        }
    }

    /**
     * Skip the spaces, the newlines and the comments
     */
    protected skip(): void {
        for (; ;) {
            const char: string = this.text[this.offset]
            if (char === ' ' || char === '\t' || char === '\r' || char === '\n') this.offset++
            else if (char === '#') this.comment()
            else return
        }
    }

    public parse(): CMakeCommand[] {
        const commands: CMakeCommand[] = []
        let depth: number = 0
        for (; ;) {
            this.skip()
            if (this.offset >= this.text.length) return commands
            const start: number = this.offset
            const identifier: RegExpExecArray | null = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.text.slice(this.offset))
            if (!identifier) this.error(`unexpected ${JSON.stringify(this.text[this.offset])}`)
            this.offset += identifier[0].length
            while (this.text[this.offset] === ' ' || this.text[this.offset] === '\t') this.offset++
            if (this.text[this.offset] !== '(') this.error('expected "(" after the name of the command')
            this.offset++
            const args: CMakeArgument[] = this.arguments()
            const name: string = identifier[0].toLowerCase()
            //The commands closing a block are at the depth of their opening one
            if (Object.values(BLOCKS).includes(name)) depth = Math.max(0, depth - 1)
            commands.push({name: name, args: args, start: start, end: this.offset, depth: ['else', 'elseif'].includes(name) ? Math.max(0, depth - 1) : depth})
            if (name in BLOCKS) depth++
        }
    }

    /**
     * The arguments of a command, until its closing parenthesis (the parentheses nested are unquoted arguments)
     */
    protected arguments(): CMakeArgument[] {
        const args: CMakeArgument[] = []
        let nested: number = 0
        for (; ;) {
            this.skip()
            if (this.offset >= this.text.length) this.error('unterminated command')
            const char: string = this.text[this.offset]
            const start: number = this.offset
            if (char === ')') {
                this.offset++
                if (nested === 0) return args
                nested--
                args.push({kind: 'unquoted', value: ')', start: start, end: this.offset})
            } else if (char === '(') {
                this.offset++
                nested++
                args.push({kind: 'unquoted', value: '(', start: start, end: this.offset})
            } else if (char === '[' && this.bracketLevel(this.offset) >= 0) {
                args.push({kind: 'bracket', value: this.bracket(), start: start, end: this.offset})
            } else if (char === '"') {
                args.push({kind: 'quoted', value: this.quoted(), start: start, end: this.offset})
            } else {
                args.push({kind: 'unquoted', value: this.unquoted(), start: start, end: this.offset})
            }
        }
    }

    protected quoted(): string {
        const start: number = this.offset
        this.offset++
        let value: string = ''
        for (; ;) {
            if (this.offset >= this.text.length) this.error('unterminated quoted argument', start)
            const char: string = this.text[this.offset]
            if (char === '"') {
                this.offset++
                return value
            }
            if (char === '\\') {
                const next: string = this.text[this.offset + 1] ?? ''
                //A line continuation, an encoded escape, or the character escaped
                value += next === '\n' ? '' : next === 't' ? '\t' : next === 'r' ? '\r' : next === 'n' ? '\n' : next === ';' ? '\;' : next
                this.offset += 2
                continue
            }
            value += char
            this.offset++
        }
    }

    /**
     * An unquoted argument: its characters but the whitespaces and ()#"\ (escaped by \), with the quoted parts of the
     * legacy arguments (-Da="b c")
     */
    protected unquoted(): string {
        let value: string = ''
        for (; ;) {
            const char: string | undefined = this.text[this.offset]
            if (char === undefined || /[\s()#]/.test(char)) return value
            if (char === '\\') {
                value += this.text.slice(this.offset, this.offset + 2)
                this.offset += 2
            } else if (char === '"') {
                //The quotes inside of a legacy unquoted argument
                const end: number = this.text.indexOf('"', this.offset + 1)
                if (end < 0) this.error('unterminated quote')
                value += this.text.slice(this.offset, end + 1)
                this.offset = end + 1
            } else {
                value += char
                this.offset++
            }
        }
    }
}

/**
 * A file of CMake (CMakeLists.txt), parsed with the places of its commands: it is changed by edits of its text, its
 * comments and its layout kept
 */
export class CMakeDocument {
    public readonly commands: CMakeCommand[]
    public readonly indent: string
    protected readonly edits: TextEdit[] = []

    constructor(public readonly file: string, public readonly text: string) {
        this.commands = new CMakeParser(file, text).parse()
        this.indent = indentUnit(text)
    }

    public static async read(file: string): Promise<CMakeDocument> {
        return new CMakeDocument(file, await readFile(file, 'utf8'))
    }

    public get changes(): TextEdit[] {
        return this.edits
    }

    /**
     * The document with its changes (parsed again)
     */
    public applied(): CMakeDocument {
        return new CMakeDocument(this.file, applyEdits(this.text, this.edits))
    }

    /**
     * The value of an argument, its variables resolved (${PROJECT_NAME}, the variables set at the top level)
     * @param value
     */
    public resolve(value: string): string {
        const variables: Map<string, string> = new Map()
        for (const command of this.commands) {
            if (command.depth !== 0) continue
            if (command.name === 'project' && command.args[0]) variables.set('PROJECT_NAME', command.args[0].value)
            if (command.name === 'set' && command.args.length === 2) variables.set(command.args[0].value, command.args[1].value)
        }
        return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (all: string, name: string): string => variables.get(name) ?? all)
    }

    /**
     * The targets of the libraries and the executables: their name, and the text naming them in their command
     */
    public targets(): { name: string, text: string, command: CMakeCommand }[] {
        return this.commands
            .filter((command: CMakeCommand): boolean => (command.name === 'add_library' || command.name === 'add_executable') && command.args.length > 0)
            .map((command: CMakeCommand): { name: string, text: string, command: CMakeCommand } => ({
                name: this.resolve(command.args[0].value),
                text: this.text.slice(command.args[0].start, command.args[0].end),
                command: command
            }))
    }

    /**
     * The target changed: the one named, the only one by default
     * @param name
     */
    public target(name?: string): { name: string, text: string, command: CMakeCommand } {
        const targets = this.targets()
        if (!targets.length) throw new Error(`${this.file} declares no target (add_library)`)
        if (name !== undefined) {
            const target = targets.find((candidate): boolean => candidate.name === name)
            if (!target) throw new Error(`${this.file} has no target ${name} (${targets.map((candidate): string => candidate.name).join(', ')})`)
            return target
        }
        if (targets.length > 1) throw new Error(`${this.file} has several targets (${targets.map((candidate): string => candidate.name).join(', ')}): --target gives the one changed`)
        return targets[0]
    }

    /**
     * Whether a command with these arguments exists (the arguments compared by their resolved values)
     * @param name
     * @param args
     */
    public has(name: string, args: string[]): boolean {
        const expected: string[] = args.map((arg: string): string => this.resolve(arg.replace(/^"(.*)"$/, '$1')))
        return this.commands.some((command: CMakeCommand): boolean => command.name === name.toLowerCase() &&
            command.args.length === expected.length &&
            command.args.every((arg: CMakeArgument, index: number): boolean => this.resolve(arg.value) === expected[index]))
    }

    /**
     * Insert commands after the last command of the top level about a target (its add_library, its target_* and
     * set_target_properties commands, the add_custom_command of the target), on lines of their own
     * @param target
     * @param lines the commands, a line each
     * @param condition the condition of the if block they are given in
     */
    public insertAfterTarget(target: { name: string, command: CMakeCommand }, lines: string[], condition?: string): void {
        const about: CMakeCommand[] = this.commands.filter((command: CMakeCommand): boolean => command.depth === 0 && (command === target.command ||
            ((command.name.startsWith('target_') || command.name === 'set_target_properties') && command.args[0] !== undefined && this.resolve(command.args[0].value) === target.name) ||
            (command.name === 'add_custom_command' && command.args[0]?.value.toUpperCase() === 'TARGET' && command.args[1] !== undefined && this.resolve(command.args[1].value) === target.name)))
        //Inside of the block of the condition about the target already written
        if (condition !== undefined) {
            const block: CMakeCommand | undefined = this.conditionBlock(target, condition)
            if (block) {
                const last: CMakeCommand = this.commands[this.commands.indexOf(block) - 1]
                const indent: string = this.commands[this.commands.indexOf(block) - 1].depth === 1 ? lineIndent(this.text, last.start) : lineIndent(this.text, block.start) + this.indent
                this.edits.push({offset: lineEndOf(this.text, last.end), remove: 0, insert: `\n${lines.map((line: string): string => `${indent}${line}`).join('\n')}`})
                return
            }
        }
        //The block of a condition: the if blocks of the target are followed by the next one
        const anchor: CMakeCommand = this.blockEnd(about.at(-1)!)
        const indent: string = lineIndent(this.text, anchor.start)
        const block: string = condition === undefined
            ? lines.map((line: string): string => `${indent}${line}`).join('\n')
            : [`${indent}if(${condition})`, ...lines.map((line: string): string => `${indent}${this.indent}${line}`), `${indent}endif()`].join('\n')
        this.edits.push({offset: lineEndOf(this.text, anchor.end), remove: 0, insert: `\n${block}`})
    }

    /**
     * The endif of a block of the top level with a condition, after the target, holding only commands about it (its if
     * has no else)
     * @param target
     * @param condition
     */
    protected conditionBlock(target: { name: string, command: CMakeCommand }, condition: string): CMakeCommand | undefined {
        const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()
        for (let index: number = this.commands.indexOf(target.command) + 1; index < this.commands.length; index++) {
            const command: CMakeCommand = this.commands[index]
            if (command.name !== 'if' || command.depth !== 0) continue
            const open: number = this.text.indexOf('(', command.start)
            if (normalize(this.text.slice(open + 1, command.end - 1)) !== normalize(condition)) continue
            let end: number = index + 1
            let about: boolean = true
            while (end < this.commands.length && !(this.commands[end].depth === 0 && this.commands[end].name === 'endif')) {
                const inner: CMakeCommand = this.commands[end]
                if (inner.depth === 0) about = false
                else if (inner.depth === 1 && !(['find_package', 'pkg_check_modules'].includes(inner.name) || (['target_link_libraries', 'target_include_directories', 'target_compile_definitions', 'set_target_properties', 'add_custom_command'].includes(inner.name) &&
                    [inner.args[0]?.value, inner.args[1]?.value].some((arg: string | undefined): boolean => arg !== undefined && this.resolve(arg) === target.name)))) about = false
                end++
            }
            if (about && end > index + 1 && end < this.commands.length) return this.commands[end]
        }
        return undefined
    }

    /**
     * The last command of the if blocks following a command (the conditions about a target written after it)
     * @param command
     */
    protected blockEnd(command: CMakeCommand): CMakeCommand {
        let index: number = this.commands.indexOf(command)
        for (; ;) {
            const next: CMakeCommand | undefined = this.commands[index + 1]
            if (next?.name !== 'if' || next.depth !== 0) return this.commands[index]
            //The block, until its endif
            let end: number = index + 2
            while (end < this.commands.length && !(this.commands[end].name === 'endif' && this.commands[end].depth === 0)) end++
            //Its commands are about the target only when the first one is
            const first: CMakeCommand | undefined = this.commands[index + 2]
            if (!first || first.depth !== 1 || !(first.name.startsWith('target_') || ['set_target_properties', 'add_custom_command', 'find_package', 'pkg_check_modules'].includes(first.name))) return this.commands[index]
            index = end
        }
    }
}

/**
 * An argument of CMake for a value: quoted when it has spaces, semicolons, parentheses or quotes
 * @param value
 */
export function cMakeArgumentText(value: string): string {
    return /[\s;()#"\\]/.test(value) && !/^\$<.*>$/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value
}
