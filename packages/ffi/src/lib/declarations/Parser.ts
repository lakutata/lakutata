import {NativeDeclarationException} from '../../exceptions/NativeDeclarationException.js'
import {annotationDirection, builtinTypes, CONSTS, CONVENTIONS, IGNORED, INLINES} from './Builtins.js'
import {alignmentOf, sizeOf} from './Layout.js'
import {declarationError, type Token, tokenize} from './Lexer.js'
import type {Platform} from './Platform.js'
import {
    type CallingConvention,
    type CType,
    type Declarations,
    type Direction,
    emptyDeclarations,
    type EnumType,
    type FunctionDeclaration,
    type FunctionType,
    type MacroToken,
    type Member,
    type Parameter,
    type PrimitiveName,
    primitiveSigned,
    primitiveSize,
    type RecordType,
    typeText,
    VOID
} from './Types.js'

/**
 * The words of the arithmetic types, combined as C combines them (unsigned long long int)
 */
const TYPE_WORDS: ReadonlySet<string> = new Set(['void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '__signed', '__signed__', '_Bool', '__int8', '__int16', '__int32', '__int64', '__int128', '_Complex', '__complex__', '_Float16', '__fp16', '_Float128', '__float128'])

const ATTRIBUTES: ReadonlySet<string> = new Set(['__attribute__', '__attribute', '__declspec'])

const ASM: ReadonlySet<string> = new Set(['__asm__', '__asm', 'asm'])

const ALIGNAS: ReadonlySet<string> = new Set(['_Alignas', 'alignas', '__alignas'])

/**
 * The specifiers of a declaration: its base type, its storage, its qualifiers and annotations
 */
interface Specifiers {
    base: CType
    storage?: 'typedef' | 'extern' | 'static'
    inline: boolean
    constant: boolean
    convention?: CallingConvention
    direction?: Direction
    align?: number
    threadLocal: boolean
}

/**
 * What a declarator declares: its name, and how its type is made from the base type of the specifiers
 */
interface Declarator {
    name?: string
    token?: Token
    build: (base: CType, baseConst: boolean) => { type: CType, constant: boolean }
    /**
     * The calling convention written in it (__stdcall *fp), for the function type around it
     */
    convention?: CallingConvention
    asm?: string
    direction?: Direction
    align?: number
}

/**
 * An integer of a constant expression, with the type C gives it (for ~, the shifts and the casts)
 */
interface Integer {
    value: bigint
    unsigned: boolean
    bits: number
}

/**
 * Reads C declarations: typedefs, structs, unions, enums, function prototypes and variables, for one platform. Each
 * library has its own declarations: their names do not meet the ones of another library
 */
export class DeclarationParser {

    readonly #platform: Platform

    readonly #declarations: Declarations

    readonly #builtins: Map<string, CType>

    #tokens: Token[] = []

    #index: number = 0

    //The packing of #pragma pack, and its stack
    #pack?: number

    #packs: (number | undefined)[] = []

    /**
     * Read declarations for a platform.
     * @param platform The platform: the sizes of the types and the layout of the structs depend on it.
     * @param declarations Declarations already read, added to (the ones of the library, when a prototype is read).
     */
    constructor(platform: Platform, declarations: Declarations = emptyDeclarations()) {
        this.#platform = platform
        this.#declarations = declarations
        this.#builtins = builtinTypes(platform)
    }

    /**
     * The declarations read so far.
     */
    public get declarations(): Declarations {
        return this.#declarations
    }

    /**
     * Read a text of declarations, adding what it declares.
     * @param text The declarations, as a header writes them (preprocessed or not: #pragma pack is read, #define and
     * #include are skipped, #if and its kind are refused).
     */
    public parse(text: string): Declarations {
        this.#tokens = this.#expand(tokenize(text))
        this.#index = 0
        while (!this.#at('end')) this.#declaration()
        this.#macroConstants()
        return this.#declarations
    }

    /**
     * Read the prototype of one function (a trailing semicolon is optional).
     * @param text The prototype: `int sqlite3_open(const char *filename, _Out_ sqlite3 **db)`.
     */
    public prototype(text: string): FunctionDeclaration {
        this.#tokens = this.#expand(tokenize(text))
        this.#index = 0
        const start: Token = this.#peek()
        const specifiers: Specifiers = this.#specifiers(false)
        const declarator: Declarator = this.#declarator(false)
        const {type} = declarator.build(specifiers.base, specifiers.constant)
        if (type.kind !== 'function' || !declarator.name) throw this.#error('A function prototype is expected', start)
        this.#attributes()
        const asm: string | undefined = this.#asmLabel() ?? declarator.asm
        if (this.#isPunctuator(';')) this.#next()
        if (!this.#at('end')) throw this.#error(`Unexpected ${this.#describe(this.#peek())} after the prototype`, this.#peek())
        return {name: declarator.name, symbol: this.#symbol(declarator.name, asm), type: this.#withConvention(type, declarator.convention ?? specifiers.convention)}
    }

    /**
     * Read a type name: `struct timeval`, `const char *`, `int[4]`.
     * @param text The type.
     */
    public typeName(text: string): CType {
        this.#tokens = this.#expand(tokenize(text))
        this.#index = 0
        const specifiers: Specifiers = this.#specifiers(false)
        const declarator: Declarator = this.#declarator(true)
        if (declarator.name) throw this.#error(`A type is expected, not a declaration of ${declarator.name}`, declarator.token!)
        if (!this.#at('end')) throw this.#error(`Unexpected ${this.#describe(this.#peek())} after the type`, this.#peek())
        return declarator.build(specifiers.base, specifiers.constant).type
    }

    /**
     * The value of a constant expression of the declarations (`SQLITE_OK + 1`, `1 << 4`).
     * @param text The expression.
     */
    public constant(text: string): bigint {
        this.#tokens = this.#expand(tokenize(text))
        this.#index = 0
        const value: Integer = this.#expression()
        if (!this.#at('end')) throw this.#error(`Unexpected ${this.#describe(this.#peek())} after the expression`, this.#peek())
        return value.value
    }

    /**
     * The tokens with the macros without arguments expanded where they are used (their definitions removed from them);
     * a macro with arguments used is refused
     * @param tokens
     */
    #expand(tokens: Token[]): Token[] {
        const macros: Map<string, MacroToken[] | null> = this.#declarations.macros
        const expanded: Token[] = []
        const expandInto = (token: Token, active: ReadonlySet<string>, at: Token): void => {
            const body: MacroToken[] | null | undefined = token.kind === 'identifier' && !active.has(token.text) ? macros.get(token.text) : undefined
            if (body === null) throw this.#error(`The macro ${token.text} takes arguments: the macros with arguments are not supported (write what it expands to)`, at)
            if (!body) return void expanded.push(token)
            const inner: Set<string> = new Set(active).add(token.text)
            for (const part of body) expandInto({...part, line: at.line, column: at.column}, inner, at)
        }
        for (const token of tokens) {
            if (token.kind === 'define') {
                this.#define(token)
                continue
            }
            if (token.kind === 'undef') {
                macros.delete(token.text.match(/^[A-Za-z_]\w*/)?.[0] ?? '')
                continue
            }
            expandInto(token, new Set(), token)
        }
        return expanded
    }

    /**
     * A #define: a macro without arguments (its tokens kept), or one with arguments (refused where used)
     * @param token
     */
    #define(token: Token): void {
        const name: string | undefined = token.text.match(/^[A-Za-z_]\w*/)?.[0]
        if (!name) throw this.#error('#define without a name', token)
        const rest: string = token.text.slice(name.length)
        if (rest.startsWith('(')) {
            this.#declarations.macros.set(name, null)
            return
        }
        const body: MacroToken[] = []
        for (const part of tokenize(rest)) {
            if (part.kind === 'end') break
            if (part.kind === 'pragma' || part.kind === 'define' || part.kind === 'undef') continue
            body.push({kind: part.kind, text: part.text, ...part.value !== undefined ? {value: part.value} : {}, ...part.float ? {float: true} : {}})
        }
        this.#declarations.macros.set(name, body)
    }

    /**
     * The macros whose value is an integer constant expression, as constants
     */
    #macroConstants(): void {
        const tokens: Token[] = this.#tokens
        const index: number = this.#index
        for (const [name, body] of this.#declarations.macros) {
            if (!body?.length || this.#declarations.constants.has(name)) continue
            try {
                const end: Token = {kind: 'end', text: '', line: 0, column: 0}
                this.#tokens = [...this.#expand([{kind: 'identifier', text: name, line: 0, column: 0}]), end]
                this.#index = 0
                const value: Integer = this.#conditional()
                if (this.#at('end')) this.#declarations.constants.set(name, value.value)
            } catch {
                //Not an integer constant (a string, a type, an expression of what is not constant)
            }
        }
        this.#tokens = tokens
        this.#index = index
    }

    /**
     * A declaration, or a #pragma pack
     */
    #declaration(): void {
        const token: Token = this.#peek()
        if (token.kind === 'pragma') {
            this.#next()
            return this.#pragmaPack(token)
        }
        if (this.#isPunctuator(';')) {
            this.#next()
            return
        }
        //extern "C" { … } of the headers shared with C++
        if (token.kind === 'identifier' && token.text === 'extern' && this.#peek(1).kind === 'string') {
            this.#next()
            this.#next()
            if (this.#isPunctuator('{')) {
                this.#next()
                while (!this.#isPunctuator('}')) {
                    if (this.#at('end')) throw this.#error('extern "C" { is not closed', token)
                    this.#declaration()
                }
                this.#next()
            }
            return
        }
        //_Static_assert
        if (token.kind === 'identifier' && ['_Static_assert', 'static_assert'].includes(token.text)) {
            this.#next()
            this.#skipBalanced()
            this.#expectPunctuator(';')
            return
        }
        const specifiers: Specifiers = this.#specifiers(true)
        if (this.#isPunctuator(';')) {
            this.#next()
            return
        }
        for (; ;) {
            const declarator: Declarator = this.#declarator(false)
            this.#attributes()
            const asm: string | undefined = this.#asmLabel() ?? declarator.asm
            this.#attributes()
            //A function defined here (an inline function of a header): its body is skipped
            if (this.#isPunctuator('{')) {
                this.#skipBalanced()
                return
            }
            let initializer: Integer | undefined
            if (this.#isPunctuator('=')) {
                this.#next()
                initializer = this.#initializer()
            }
            this.#declare(specifiers, declarator, asm, initializer)
            if (this.#isPunctuator(',')) {
                this.#next()
                continue
            }
            this.#expectPunctuator(';')
            return
        }
    }

    /**
     * What a declarator of a declaration declares: a typedef, a function, a variable, a constant
     * @param specifiers
     * @param declarator
     * @param asm
     * @param initializer
     */
    #declare(specifiers: Specifiers, declarator: Declarator, asm: string | undefined, initializer: Integer | undefined): void {
        if (!declarator.name) throw this.#error('A name is expected in the declaration', this.#peek())
        const name: string = declarator.name
        const {type, constant} = declarator.build(specifiers.base, specifiers.constant)
        if (specifiers.storage === 'typedef') {
            const previous: CType | undefined = this.#declarations.types.get(name)
            if (previous && previous !== type && typeText(previous) !== typeText(type)) throw this.#error(`The type ${name} is declared again as another type (${typeText(previous)}, then ${typeText(type)})`, declarator.token!)
            this.#declarations.types.set(name, type)
            return
        }
        if (type.kind === 'function') {
            if (specifiers.storage === 'static') return
            this.#declarations.functions.set(name, {name: name, symbol: this.#symbol(name, asm), type: this.#withConvention(type, declarator.convention ?? specifiers.convention)})
            return
        }
        //static const int LIMIT = 10;: a constant
        if (specifiers.storage === 'static') {
            if (initializer && constant) this.#declarations.constants.set(name, initializer.value)
            return
        }
        if (specifiers.threadLocal) throw this.#error(`The variable ${name} is thread-local: it cannot be reached through the library`, declarator.token!)
        this.#declarations.variables.set(name, {name: name, symbol: this.#symbol(name, asm), type: type, constant: constant})
    }

    /**
     * The symbol of a function or a variable: its name, or the label of its __asm (without the underscore the binaries
     * of macOS add)
     * @param name
     * @param asm
     */
    #symbol(name: string, asm: string | undefined): string {
        if (asm === undefined) return name
        return this.#platform.underscoredSymbols && asm.startsWith('_') ? asm.slice(1) : asm
    }

    /**
     * A function type with its calling convention
     * @param type
     * @param convention
     */
    #withConvention(type: FunctionType, convention: CallingConvention | undefined): FunctionType {
        return convention && convention !== type.convention ? {...type, convention: convention} : type
    }

    /**
     * #pragma pack(n), pack(push, n), pack(push, name, n), pack(pop), pack(pop, name), pack()
     * @param token
     */
    #pragmaPack(token: Token): void {
        const args: string[] = token.text.slice(5, -1).split(',').filter(Boolean)
        const value = (text: string | undefined): number | undefined => {
            if (text === undefined) return undefined
            const number: number = Number(text)
            if (![1, 2, 4, 8, 16].includes(number)) throw this.#error(`#pragma pack(${text}) is not a packing of 1, 2, 4, 8 or 16`, token)
            return number >= 16 ? undefined : number
        }
        if (!args.length) {
            this.#pack = undefined
        } else if (args[0] === 'push') {
            this.#packs.push(this.#pack)
            const number: string | undefined = args.slice(1).find((arg: string): boolean => /^\d+$/.test(arg))
            if (number !== undefined) this.#pack = value(number)
        } else if (args[0] === 'pop') {
            this.#pack = this.#packs.length ? this.#packs.pop() : undefined
        } else {
            this.#pack = value(args[0])
        }
    }

    /**
     * The specifiers of a declaration: the storage, the qualifiers, the base type (arithmetic words, a typedef, a
     * struct, a union, an enum), the calling convention, the annotations
     * @param declaration whether a whole declaration is read (typedef, extern and static are allowed)
     */
    #specifiers(declaration: boolean): Specifiers {
        const start: Token = this.#peek()
        const words: string[] = []
        let base: CType | undefined
        const specifiers: Specifiers = {base: VOID, inline: false, constant: false, threadLocal: false}
        for (; ;) {
            const token: Token = this.#peek()
            if (token.kind !== 'identifier') {
                //[[nodiscard]]
                if (this.#isPunctuator('[') && this.#isPunctuator('[', 1)) {
                    this.#skipBalanced()
                    continue
                }
                break
            }
            const word: string = token.text
            if (CONSTS.has(word)) {
                this.#next()
                specifiers.constant = true
                continue
            }
            if (IGNORED.has(word)) {
                this.#next()
                continue
            }
            if (INLINES.has(word)) {
                this.#next()
                specifiers.inline = true
                continue
            }
            if (CONVENTIONS.has(word)) {
                this.#next()
                specifiers.convention = CONVENTIONS.get(word)
                continue
            }
            if (ATTRIBUTES.has(word)) {
                const align: number | undefined = this.#attributes()?.align
                if (align) specifiers.align = align
                continue
            }
            if (ALIGNAS.has(word)) {
                specifiers.align = this.#alignas()
                continue
            }
            if (word === 'typedef' || word === 'extern' || word === 'static') {
                if (!declaration) throw this.#error(`${word} is not allowed here`, token)
                this.#next()
                specifiers.storage = word
                continue
            }
            if (word === '_Thread_local' || word === '__thread' || word === 'thread_local') {
                this.#next()
                specifiers.threadLocal = true
                continue
            }
            if (word === 'struct' || word === 'union') {
                if (base || words.length) throw this.#error(`${word} after another type`, token)
                base = this.#record(word)
                continue
            }
            if (word === 'enum') {
                if (base || words.length) throw this.#error(`enum after another type`, token)
                base = this.#enumeration()
                continue
            }
            if (TYPE_WORDS.has(word)) {
                if (base) throw this.#error(`${word} after another type`, token)
                this.#next()
                words.push(word)
                continue
            }
            //An annotation (_Out_, _In_reads_(n), OUT), unless a type of that name is declared
            if (!this.#typedef(word)) {
                const direction: Direction | null | undefined = annotationDirection(word)
                if (direction !== undefined) {
                    this.#next()
                    if (this.#isPunctuator('(')) this.#skipBalanced()
                    if (direction) specifiers.direction = direction
                    continue
                }
            }
            //A typedef name, when no type was given yet; otherwise it is the name declared
            if (!base && !words.length) {
                const typedef: CType | undefined = this.#typedef(word)
                if (typedef) {
                    this.#next()
                    base = typedef
                    continue
                }
                throw this.#unknownType(token)
            }
            break
        }
        if (words.length) base = this.#arithmetic(words, start)
        if (!base) throw this.#peek().kind === 'identifier' ? this.#unknownType(this.#peek()) : this.#error(`A type is expected, not ${this.#describe(this.#peek())}`, this.#peek())
        specifiers.base = base
        return specifiers
    }

    /**
     * The exception of a name used as a type and not declared; a name in capitals may be a macro
     * @param token
     */
    #unknownType(token: Token): NativeDeclarationException {
        const macro: string = /^[A-Z][A-Z0-9_]*$/.test(token.text) ? ': a macro? give its #define with the declarations' : ''
        return this.#error(`Unknown type ${token.text}${macro}`, token)
    }

    /**
     * The arithmetic type of the words of a declaration (unsigned long long int)
     * @param words
     * @param token
     */
    #arithmetic(words: string[], token: Token): CType {
        const count = (word: string): number => words.filter((candidate: string): boolean => candidate === word).length
        const unsigned: boolean = count('unsigned') > 0
        const signed: boolean = count('signed') + count('__signed') + count('__signed__') > 0
        const longs: number = count('long')
        const name = (value: PrimitiveName): CType => ({kind: 'primitive', name: value})
        const has = (word: string): boolean => words.includes(word)
        if (['__int128', '_Complex', '__complex__', '_Float16', '__fp16', '_Float128', '__float128'].some(has)) throw this.#error(`The type ${words.join(' ')} is not supported`, token)
        if (has('void')) return VOID
        if (has('_Bool')) return name('bool')
        if (has('float')) return name('float')
        if (has('double')) {
            if (longs) throw this.#error('long double is not supported', token)
            return name('double')
        }
        if (has('char')) return name(unsigned ? 'uchar' : signed ? 'schar' : 'char')
        if (has('__int8')) return name(unsigned ? 'uint8' : 'int8')
        if (has('__int16')) return name(unsigned ? 'uint16' : 'int16')
        if (has('__int32')) return name(unsigned ? 'uint32' : 'int32')
        if (has('__int64')) return name(unsigned ? 'uint64' : 'int64')
        if (has('short')) return name(unsigned ? 'ushort' : 'short')
        if (longs >= 2) return name(unsigned ? 'ulonglong' : 'longlong')
        if (longs === 1) return name(unsigned ? 'ulong' : 'long')
        return name(unsigned ? 'uint' : 'int')
    }

    /**
     * The type of a typedef name: declared, or built in
     * @param name
     */
    #typedef(name: string): CType | undefined {
        return this.#declarations.types.get(name) ?? this.#builtins.get(name)
    }

    /**
     * A struct or a union: a reference to its tag, its declaration, or its definition
     * @param kind
     */
    #record(kind: 'struct' | 'union'): RecordType {
        const keyword: Token = this.#next()
        let attributes: { packed: boolean, align?: number } | undefined = this.#attributes()
        let tag: string | undefined
        let tagToken: Token | undefined
        if (this.#peek().kind === 'identifier' && !ATTRIBUTES.has(this.#peek().text)) {
            tagToken = this.#next()
            tag = tagToken.text
            attributes = this.#attributes() ?? attributes
        }
        const key: string = `${kind} ${tag}`
        let record: RecordType | undefined
        if (tag) {
            const known: RecordType | EnumType | undefined = this.#declarations.tags.get(key)
            if (known && known.kind !== kind) throw this.#error(`${tag} is a ${known.kind}, not a ${kind}`, tagToken!)
            record = known as RecordType | undefined
        }
        if (!this.#isPunctuator('{')) {
            if (!tag) throw this.#error(`A ${kind} without a name must be defined`, keyword)
            if (!record) {
                //Declared, not defined: an opaque type, completed if defined later
                record = {kind: kind, tag: tag}
                this.#declarations.tags.set(key, record)
            }
            return record
        }
        if (record?.members) throw this.#error(`The ${kind} ${tag} is defined again`, tagToken!)
        if (!record) {
            record = {kind: kind, tag: tag}
            if (tag) this.#declarations.tags.set(key, record)
        }
        this.#next()
        const members: Member[] = []
        let anonymous: number = 0
        while (!this.#isPunctuator('}')) {
            if (this.#at('end')) throw this.#error(`The ${kind} ${tag ?? ''} is not closed`.replace('  ', ' '), keyword)
            if (this.#peek().kind === 'pragma') {
                this.#pragmaPack(this.#next())
                continue
            }
            if (this.#isPunctuator(';')) {
                this.#next()
                continue
            }
            const specifiers: Specifiers = this.#specifiers(false)
            //An anonymous struct or union member: its members are reached through the name _0, _1…
            if (this.#isPunctuator(';')) {
                this.#next()
                if (specifiers.base.kind === 'struct' || specifiers.base.kind === 'union') members.push({name: `_${anonymous++}`, type: specifiers.base, align: specifiers.align})
                continue
            }
            for (; ;) {
                let declarator: Declarator | undefined
                if (!this.#isPunctuator(':')) declarator = this.#declarator(false)
                let bits: number | undefined
                if (this.#isPunctuator(':')) {
                    this.#next()
                    const width: Integer = this.#conditional()
                    bits = Number(width.value)
                    if (bits < 0) throw this.#error('A bitfield has a negative width', this.#peek())
                }
                const memberAttributes: { packed: boolean, align?: number } | undefined = this.#attributes()
                if (!declarator?.name && bits === undefined) throw this.#error('A member name is expected', this.#peek())
                const built: CType = declarator ? declarator.build(specifiers.base, specifiers.constant).type : specifiers.base
                if (built.kind === 'function') throw this.#error(`The member ${declarator?.name} is a function: a pointer to a function is expected`, declarator?.token ?? this.#peek())
                if (built.kind === 'struct' || built.kind === 'union') {
                    if (!built.members) throw this.#error(`The member ${declarator?.name} has the type ${typeText(built)}, declared but not defined`, declarator?.token ?? this.#peek())
                }
                const align: number | undefined = memberAttributes?.align ?? declarator?.align ?? specifiers.align
                members.push({name: declarator?.name ?? '', type: built, ...bits !== undefined ? {bits: bits} : {}, ...align ? {align: align} : {}})
                if (this.#isPunctuator(',')) {
                    this.#next()
                    continue
                }
                this.#expectPunctuator(';')
                break
            }
        }
        this.#next()
        const after: { packed: boolean, align?: number } | undefined = this.#attributes()
        const packed: boolean = !!(attributes?.packed || after?.packed)
        record.members = members
        if (packed) record.pack = 1
        else if (this.#pack !== undefined) record.pack = this.#pack
        const align: number | undefined = after?.align ?? attributes?.align
        if (align) record.align = align
        return record
    }

    /**
     * An enumeration: its tag, or its definition (the values evaluated, the constants added)
     */
    #enumeration(): EnumType {
        const keyword: Token = this.#next()
        this.#attributes()
        let tag: string | undefined
        if (this.#peek().kind === 'identifier' && !ATTRIBUTES.has(this.#peek().text)) tag = this.#next().text
        this.#attributes()
        let base: PrimitiveName | undefined
        if (this.#isPunctuator(':')) {
            this.#next()
            const type: CType = this.#specifiers(false).base
            if (type.kind !== 'primitive' || type.name === 'void' || type.name === 'float' || type.name === 'double') throw this.#error('The type of an enumeration must be an integer type', keyword)
            base = type.name
        }
        const key: string = `enum ${tag}`
        if (!this.#isPunctuator('{')) {
            const known: RecordType | EnumType | undefined = tag ? this.#declarations.tags.get(key) : undefined
            if (known?.kind === 'enum') return known
            if (!tag) throw this.#error('An enumeration without a name must be defined', keyword)
            //Declared before its values (enum e : int;), or used before: its values are not known, its type is
            const declared: EnumType = {kind: 'enum', tag: tag, base: base ?? 'int', values: new Map()}
            this.#declarations.tags.set(key, declared)
            return declared
        }
        this.#next()
        const values: Map<string, bigint> = new Map()
        let next: bigint = 0n
        while (!this.#isPunctuator('}')) {
            const name: Token = this.#next()
            if (name.kind !== 'identifier') throw this.#error(`An enumerator name is expected, not ${this.#describe(name)}`, name)
            this.#attributes()
            if (this.#isPunctuator('=')) {
                this.#next()
                next = this.#conditional().value
            }
            values.set(name.text, next)
            this.#declarations.constants.set(name.text, next)
            next++
            if (this.#isPunctuator(',')) this.#next()
            else if (!this.#isPunctuator('}')) throw this.#error(`, or } is expected, not ${this.#describe(this.#peek())}`, this.#peek())
        }
        this.#next()
        this.#attributes()
        const type: EnumType = {kind: 'enum', tag: tag, base: base ?? this.#enumBase([...values.values()]), values: values}
        if (tag) this.#declarations.tags.set(key, type)
        return type
    }

    /**
     * The integer type of an enumeration without one: int, or the smallest type holding its values (GCC and Clang; the
     * compiler of Microsoft keeps int)
     * @param values
     */
    #enumBase(values: bigint[]): PrimitiveName {
        const negative: boolean = values.some((value: bigint): boolean => value < 0n)
        const fits = (min: bigint, max: bigint): boolean => values.every((value: bigint): boolean => value >= min && value <= max)
        if (fits(-(2n ** 31n), 2n ** 31n - 1n)) return 'int'
        if (!negative && fits(0n, 2n ** 32n - 1n)) return 'uint'
        if (this.#platform.bitfields === 'msvc') return 'int'
        if (fits(-(2n ** 63n), 2n ** 63n - 1n)) return 'longlong'
        return 'ulonglong'
    }

    /**
     * A declarator: the pointers, the name (or none, abstract), the arrays and the parameters, in the order of C
     * @param abstract whether it has no name (a type name, a parameter without name)
     */
    #declarator(abstract: boolean): Declarator {
        //The pointers: each with its own constness
        const pointers: boolean[] = []
        let convention: CallingConvention | undefined
        let direction: Direction | undefined
        let align: number | undefined
        for (; ;) {
            const token: Token = this.#peek()
            if (this.#isPunctuator('*')) {
                this.#next()
                pointers.push(false)
                continue
            }
            if (token.kind !== 'identifier') break
            if (CONSTS.has(token.text) && pointers.length) {
                this.#next()
                pointers[pointers.length - 1] = true
                continue
            }
            if (CONSTS.has(token.text) || IGNORED.has(token.text)) {
                this.#next()
                continue
            }
            if (CONVENTIONS.has(token.text)) {
                this.#next()
                convention = CONVENTIONS.get(token.text)
                continue
            }
            if (ATTRIBUTES.has(token.text)) {
                align = this.#attributes()?.align ?? align
                continue
            }
            const annotation: Direction | null | undefined = this.#typedef(token.text) ? undefined : annotationDirection(token.text)
            if (annotation !== undefined) {
                this.#next()
                if (this.#isPunctuator('(')) this.#skipBalanced()
                if (annotation) direction = annotation
                continue
            }
            break
        }
        //The direct declarator: a name, a declarator in parentheses, or nothing
        let name: string | undefined
        let token: Token | undefined
        let nested: Declarator | undefined
        if (this.#peek().kind === 'identifier') {
            token = this.#next()
            name = token.text
        } else if (this.#isPunctuator('(') && this.#nestedDeclarator()) {
            this.#next()
            nested = this.#declarator(abstract)
            this.#expectPunctuator(')')
        }
        //The arrays and the parameter lists after it
        const suffixes: ({ array: number } | { function: { parameters: Parameter[], variadic: boolean } })[] = []
        for (; ;) {
            if (this.#isPunctuator('[')) {
                this.#next()
                if (this.#isPunctuator(']')) {
                    this.#next()
                    suffixes.push({array: 0})
                    continue
                }
                //[static 10], [const], [*]
                while (this.#peek().kind === 'identifier' && (this.#peek().text === 'static' || CONSTS.has(this.#peek().text) || IGNORED.has(this.#peek().text))) this.#next()
                const length: Integer = this.#conditional()
                this.#expectPunctuator(']')
                if (length.value < 0n) throw this.#error('An array has a negative length', this.#peek())
                suffixes.push({array: Number(length.value)})
                continue
            }
            if (this.#isPunctuator('(')) {
                suffixes.push({function: this.#parameters()})
                continue
            }
            break
        }
        while (this.#peek().kind === 'identifier' && (ATTRIBUTES.has(this.#peek().text) || IGNORED.has(this.#peek().text))) {
            if (ATTRIBUTES.has(this.#peek().text)) align = this.#attributes()?.align ?? align
            else this.#next()
        }
        let asm: string | undefined
        if (this.#peek().kind === 'identifier' && ASM.has(this.#peek().text)) asm = this.#asmLabel()
        const functionConvention: CallingConvention | undefined = nested?.convention ?? convention
        const declarator: Declarator = {
            name: name ?? nested?.name,
            token: token ?? nested?.token,
            convention: nested ? convention : undefined,
            asm: asm ?? nested?.asm,
            direction: direction ?? nested?.direction,
            align: align ?? nested?.align,
            build: (base: CType, baseConst: boolean): { type: CType, constant: boolean } => {
                let type: CType = base
                let targetConst: boolean = baseConst
                for (const own of pointers) {
                    type = {kind: 'pointer', to: type, constTarget: targetConst}
                    targetConst = own
                }
                for (let i: number = suffixes.length - 1; i >= 0; i--) {
                    const suffix = suffixes[i]
                    if ('array' in suffix) {
                        if (type.kind === 'function') throw this.#error('An array of functions is not allowed', token ?? this.#peek())
                        type = {kind: 'array', of: type, length: suffix.array}
                    } else {
                        type = {kind: 'function', result: type, parameters: suffix.function.parameters, variadic: suffix.function.variadic, convention: (nested ? functionConvention : undefined) ?? 'cdecl'}
                    }
                }
                if (nested) return nested.build(type, targetConst && !suffixes.length)
                return {type: type, constant: targetConst}
            }
        }
        if (!nested && convention) declarator.convention = convention
        return declarator
    }

    /**
     * Whether ( starts a declarator in parentheses ((*fp), (__stdcall *fp)) rather than a parameter list
     */
    #nestedDeclarator(): boolean {
        const next: Token = this.#peek(1)
        if (next.kind === 'punctuator') return next.text === '*' || next.text === '(' || next.text === '['
        if (next.kind !== 'identifier') return false
        if (CONVENTIONS.has(next.text) || ATTRIBUTES.has(next.text)) return true
        if (TYPE_WORDS.has(next.text) || CONSTS.has(next.text) || ['struct', 'union', 'enum'].includes(next.text) || this.#typedef(next.text)) return false
        return annotationDirection(next.text) === undefined
    }

    /**
     * A parameter list: (void), (), or the parameters with an optional ...
     */
    #parameters(): { parameters: Parameter[], variadic: boolean } {
        const open: Token = this.#next()
        const parameters: Parameter[] = []
        let variadic: boolean = false
        if (this.#isPunctuator(')')) {
            this.#next()
            return {parameters: parameters, variadic: false}
        }
        //(void)
        if (this.#peek().text === 'void' && this.#isPunctuator(')', 1)) {
            this.#next()
            this.#next()
            return {parameters: parameters, variadic: false}
        }
        //A name that is not a type: a type not declared, or a declaration of the old style (names without types)
        if (this.#peek().kind === 'identifier' && !this.#startsType(this.#peek()) && (this.#isPunctuator(',', 1) || this.#isPunctuator(')', 1))) {
            throw this.#error(`Unknown type ${this.#peek().text} (a parameter needs a type: the declarations of the old style, names without types, are not supported)`, this.#peek())
        }
        for (; ;) {
            if (this.#isPunctuator('...')) {
                this.#next()
                variadic = true
                this.#expectPunctuator(')')
                break
            }
            const specifiers: Specifiers = this.#specifiers(false)
            const declarator: Declarator = this.#declarator(true)
            let {type} = declarator.build(specifiers.base, specifiers.constant)
            //Parameters of array and function types are pointers
            if (type.kind === 'array') type = {kind: 'pointer', to: type.of, constTarget: specifiers.constant}
            if (type.kind === 'function') type = {kind: 'pointer', to: type, constTarget: false}
            if (type.kind === 'primitive' && type.name === 'void') throw this.#error('A parameter cannot be void', open)
            parameters.push({...declarator.name ? {name: declarator.name} : {}, type: type, direction: declarator.direction ?? specifiers.direction ?? 'in'})
            if (this.#isPunctuator(',')) {
                this.#next()
                continue
            }
            this.#expectPunctuator(')')
            break
        }
        return {parameters: parameters, variadic: variadic}
    }

    /**
     * Whether a token starts a type
     * @param token
     */
    #startsType(token: Token): boolean {
        if (token.kind !== 'identifier') return false
        const word: string = token.text
        return TYPE_WORDS.has(word) || CONSTS.has(word) || IGNORED.has(word) || ['struct', 'union', 'enum'].includes(word) || !!this.#typedef(word) || annotationDirection(word) !== undefined
    }

    /**
     * The attributes ahead (__attribute__((…)), __declspec(…)), the packed and aligned ones read, the others skipped
     */
    #attributes(): { packed: boolean, align?: number } | undefined {
        let result: { packed: boolean, align?: number } | undefined
        while (this.#peek().kind === 'identifier' && ATTRIBUTES.has(this.#peek().text)) {
            const keyword: Token = this.#next()
            if (!this.#isPunctuator('(')) throw this.#error(`( is expected after ${keyword.text}`, keyword)
            const start: number = this.#index
            this.#skipBalanced()
            const inner: Token[] = this.#tokens.slice(start + 1, this.#index - 1)
            result ??= {packed: false}
            for (let i: number = 0; i < inner.length; i++) {
                const word: string = inner[i].text.replace(/^__(.*)__$/, '$1')
                if (word === 'packed') result.packed = true
                if (word === 'aligned' || word === 'align') {
                    if (inner[i + 1]?.text !== '(') {
                        result.align = 16
                    } else {
                        const value: bigint | undefined = inner[i + 2]?.value
                        if (value === undefined) throw this.#error(`The alignment of ${word} must be a number`, inner[i])
                        result.align = Number(value)
                    }
                }
            }
            if (result.align !== undefined && ![1, 2, 4, 8].includes(result.align)) throw this.#error(`An alignment of ${result.align} bytes is not supported (1, 2, 4 or 8)`, keyword)
        }
        return result
    }

    /**
     * _Alignas(n), alignas(type)
     */
    #alignas(): number {
        const keyword: Token = this.#next()
        this.#expectPunctuator('(')
        let align: number
        if (this.#startsType(this.#peek())) {
            const specifiers: Specifiers = this.#specifiers(false)
            align = alignmentOf(this.#declarator(true).build(specifiers.base, specifiers.constant).type, this.#platform)
        } else {
            align = Number(this.#conditional().value)
        }
        this.#expectPunctuator(')')
        if (![1, 2, 4, 8].includes(align)) throw this.#error(`An alignment of ${align} bytes is not supported (1, 2, 4 or 8)`, keyword)
        return align
    }

    /**
     * The label of an __asm (the name of the symbol in the binary), its strings joined
     */
    #asmLabel(): string | undefined {
        if (this.#peek().kind !== 'identifier' || !ASM.has(this.#peek().text)) return undefined
        this.#next()
        this.#expectPunctuator('(')
        let label: string = ''
        while (this.#peek().kind === 'string') label += this.#next().text
        this.#expectPunctuator(')')
        return label
    }

    /**
     * The initializer of a variable: its value when it is a constant expression; a list in braces is skipped
     */
    #initializer(): Integer | undefined {
        if (this.#isPunctuator('{')) {
            this.#skipBalanced()
            return undefined
        }
        const start: number = this.#index
        try {
            return this.#conditional()
        } catch {
            //Not a constant expression: skipped to the end of the declarator
            this.#index = start
            let depth: number = 0
            while (!this.#at('end')) {
                const token: Token = this.#peek()
                if (token.kind === 'punctuator' && '([{'.includes(token.text)) depth++
                if (token.kind === 'punctuator' && ')]}'.includes(token.text)) depth--
                if (depth <= 0 && token.kind === 'punctuator' && (token.text === ',' || token.text === ';')) break
                this.#next()
            }
            return undefined
        }
    }

    /**
     * A constant expression, with the comma operator
     */
    #expression(): Integer {
        let value: Integer = this.#conditional()
        while (this.#isPunctuator(',')) {
            this.#next()
            value = this.#conditional()
        }
        return value
    }

    /**
     * A conditional expression: a ? b : c
     */
    #conditional(): Integer {
        const condition: Integer = this.#binary(0)
        if (!this.#isPunctuator('?')) return condition
        this.#next()
        const yes: Integer = this.#expression()
        this.#expectPunctuator(':')
        const no: Integer = this.#conditional()
        return condition.value !== 0n ? yes : no
    }

    /**
     * The binary operators, by precedence climbing
     * @param minimum the lowest precedence read
     */
    #binary(minimum: number): Integer {
        let left: Integer = this.#unary()
        for (; ;) {
            const token: Token = this.#peek()
            const precedence: number | undefined = token.kind === 'punctuator' ? PRECEDENCE[token.text] : undefined
            if (precedence === undefined || precedence < minimum) return left
            this.#next()
            const right: Integer = this.#binary(precedence + 1)
            left = this.#apply(token, left, right)
        }
    }

    /**
     * A binary operator applied, with the conversions of C (the wider and the unsigned type win)
     * @param operator
     * @param left
     * @param right
     */
    #apply(operator: Token, left: Integer, right: Integer): Integer {
        const bits: number = Math.max(left.bits, right.bits)
        const unsigned: boolean = (left.unsigned && left.bits >= right.bits) || (right.unsigned && right.bits >= left.bits)
        const a: bigint = left.value
        const b: bigint = right.value
        const result = (value: bigint, type: { unsigned: boolean, bits: number } = {unsigned: unsigned, bits: bits}): Integer => this.#wrap(value, type.unsigned, type.bits)
        const truth = (value: boolean): Integer => ({value: value ? 1n : 0n, unsigned: false, bits: 32})
        switch (operator.text) {
            case '*':
                return result(a * b)
            case '/':
            case '%':
                if (b === 0n) throw this.#error('Division by zero in a constant expression', operator)
                return result(operator.text === '/' ? a / b : a % b)
            case '+':
                return result(a + b)
            case '-':
                return result(a - b)
            case '<<':
                return result(a << b, left)
            case '>>':
                return result(a >> b, left)
            case '<':
                return truth(a < b)
            case '>':
                return truth(a > b)
            case '<=':
                return truth(a <= b)
            case '>=':
                return truth(a >= b)
            case '==':
                return truth(a === b)
            case '!=':
                return truth(a !== b)
            case '&':
                return result(a & b)
            case '^':
                return result(a ^ b)
            case '|':
                return result(a | b)
            case '&&':
                return truth(a !== 0n && b !== 0n)
            case '||':
                return truth(a !== 0n || b !== 0n)
        }
        throw this.#error(`The operator ${operator.text} is not allowed in a constant expression`, operator)
    }

    /**
     * An integer wrapped to its type: the unsigned ones modulo 2^bits
     * @param value
     * @param unsigned
     * @param bits
     */
    #wrap(value: bigint, unsigned: boolean, bits: number): Integer {
        if (unsigned) return {value: BigInt.asUintN(bits, value), unsigned: true, bits: bits}
        return {value: value, unsigned: false, bits: bits}
    }

    /**
     * The unary operators, the casts, sizeof and _Alignof
     */
    #unary(): Integer {
        const token: Token = this.#peek()
        if (token.kind === 'punctuator') {
            if (['+', '-', '~', '!'].includes(token.text)) {
                this.#next()
                const operand: Integer = this.#unary()
                switch (token.text) {
                    case '+':
                        return operand
                    case '-':
                        return this.#wrap(-operand.value, operand.unsigned, operand.bits)
                    case '~':
                        return this.#wrap(~operand.value, operand.unsigned, operand.bits)
                    default:
                        return {value: operand.value === 0n ? 1n : 0n, unsigned: false, bits: 32}
                }
            }
            //A cast: (type) operand
            if (token.text === '(' && this.#startsType(this.#peek(1))) {
                this.#next()
                const type: CType = this.#typeInExpression()
                this.#expectPunctuator(')')
                return this.#cast(this.#unary(), type, token)
            }
        }
        if (token.kind === 'identifier' && (token.text === 'sizeof' || ['_Alignof', 'alignof', '__alignof__', '__alignof'].includes(token.text))) {
            this.#next()
            this.#expectPunctuator('(')
            if (!this.#startsType(this.#peek())) throw this.#error(`${token.text} of an expression is not supported: give a type`, token)
            const type: CType = this.#typeInExpression()
            this.#expectPunctuator(')')
            const value: number = token.text === 'sizeof' ? sizeOf(type, this.#platform) : alignmentOf(type, this.#platform)
            return {value: BigInt(value), unsigned: true, bits: this.#platform.pointerSize * 8}
        }
        return this.#primary()
    }

    /**
     * A type name inside an expression (a cast, sizeof)
     */
    #typeInExpression(): CType {
        const specifiers: Specifiers = this.#specifiers(false)
        return this.#declarator(true).build(specifiers.base, specifiers.constant).type
    }

    /**
     * A value converted to an integer type
     * @param value
     * @param type
     * @param token
     */
    #cast(value: Integer, type: CType, token: Token): Integer {
        const name: PrimitiveName | undefined = type.kind === 'primitive' ? type.name : type.kind === 'enum' ? type.base : undefined
        if (type.kind === 'pointer') return this.#wrap(value.value, true, this.#platform.pointerSize * 8)
        if (!name || name === 'void' || name === 'float' || name === 'double') throw this.#error(`A cast to ${typeText(type)} is not allowed in a constant expression`, token)
        const bits: number = primitiveSize(name, this.#platform) * 8
        if (name === 'bool') return {value: value.value === 0n ? 0n : 1n, unsigned: true, bits: 8}
        const unsigned: boolean = !primitiveSigned(name, this.#platform)
        return unsigned ? this.#wrap(value.value, true, bits) : {value: BigInt.asIntN(bits, value.value), unsigned: false, bits: bits}
    }

    /**
     * A number, a character, a constant, or an expression in parentheses
     */
    #primary(): Integer {
        const token: Token = this.#next()
        if (token.kind === 'number') {
            if (token.float) throw this.#error(`The floating-point number ${token.text} is not allowed in an integer constant expression`, token)
            return this.#literal(token)
        }
        if (token.kind === 'char') return {value: token.value!, unsigned: false, bits: 32}
        if (token.kind === 'identifier') {
            const value: bigint | undefined = this.#declarations.constants.get(token.text)
            if (value === undefined) throw this.#error(`Unknown constant ${token.text}: a macro is not known (write its value)`, token)
            return {value: value, unsigned: value > 2n ** 31n - 1n, bits: value > 2n ** 32n - 1n || value < -(2n ** 31n) ? 64 : 32}
        }
        if (token.kind === 'punctuator' && token.text === '(') {
            const value: Integer = this.#expression()
            this.#expectPunctuator(')')
            return value
        }
        throw this.#error(`A constant expression is expected, not ${this.#describe(token)}`, token)
    }

    /**
     * The type C gives an integer literal: int, then wider or unsigned as its value and its suffix ask
     * @param token
     */
    #literal(token: Token): Integer {
        const value: bigint = token.value!
        const suffix: string = token.text.match(/[uUlL]+$/)?.[0].toLowerCase() ?? ''
        const unsignedSuffix: boolean = suffix.includes('u')
        const longs: number = (suffix.match(/l/g) ?? []).length
        const decimal: boolean = !/^0/.test(token.text) || token.text === '0'
        const longBits: number = this.#platform.longSize * 8
        const candidates: { bits: number, unsigned: boolean }[] = []
        if (longs === 0) candidates.push({bits: 32, unsigned: false}, {bits: 32, unsigned: true})
        if (longs <= 1) candidates.push({bits: longBits, unsigned: false}, {bits: longBits, unsigned: true})
        candidates.push({bits: 64, unsigned: false}, {bits: 64, unsigned: true})
        for (const candidate of candidates) {
            if (unsignedSuffix && !candidate.unsigned) continue
            //A decimal literal without u is never unsigned
            if (decimal && !unsignedSuffix && candidate.unsigned) continue
            const max: bigint = candidate.unsigned ? 2n ** BigInt(candidate.bits) - 1n : 2n ** BigInt(candidate.bits - 1) - 1n
            if (value <= max) return {value: value, unsigned: candidate.unsigned, bits: candidate.bits}
        }
        throw this.#error(`The number ${token.text} is too large`, token)
    }

    /**
     * Skip balanced brackets from the one ahead: (…), […], {…}
     */
    #skipBalanced(): void {
        const open: Token = this.#next()
        const pairs: Record<string, string> = {'(': ')', '[': ']', '{': '}'}
        const stack: string[] = [pairs[open.text]]
        while (stack.length) {
            const token: Token = this.#next()
            if (token.kind === 'end') throw this.#error(`${open.text} is not closed`, open)
            if (token.kind !== 'punctuator') continue
            if (pairs[token.text]) stack.push(pairs[token.text])
            else if (token.text === stack[stack.length - 1]) stack.pop()
        }
    }

    #peek(ahead: number = 0): Token {
        return this.#tokens[Math.min(this.#index + ahead, this.#tokens.length - 1)]
    }

    #next(): Token {
        const token: Token = this.#peek()
        if (this.#index < this.#tokens.length - 1) this.#index++
        return token
    }

    #at(kind: Token['kind']): boolean {
        return this.#peek().kind === kind
    }

    #isPunctuator(text: string, ahead: number = 0): boolean {
        const token: Token = this.#peek(ahead)
        return token.kind === 'punctuator' && token.text === text
    }

    #expectPunctuator(text: string): Token {
        if (!this.#isPunctuator(text)) throw this.#error(`${text} is expected, not ${this.#describe(this.#peek())}`, this.#peek())
        return this.#next()
    }

    #describe(token: Token): string {
        return token.kind === 'end' ? 'the end' : JSON.stringify(token.text)
    }

    #error(message: string, token: Token): NativeDeclarationException {
        return declarationError(message, token.line, token.column)
    }
}

/**
 * The precedence of the binary operators (the higher, the tighter)
 */
const PRECEDENCE: Record<string, number> = {
    '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8,
    '+': 9, '-': 9, '*': 10, '/': 10, '%': 10
}
