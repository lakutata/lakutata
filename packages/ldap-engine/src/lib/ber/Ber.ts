//The BER of LDAP (RFC 4511 §5.1): definite lengths only, OCTET STRINGs primitive only, TRUE encoded 0xFF, the low
//tag numbers only (LDAP has no tag above 30). Reading works on slices of the buffer given (nothing is copied); writing
//builds the elements first, then sizes them and writes them into one buffer, so no content is moved afterwards.

/**
 * The universal tags LDAP uses
 */
export const BerTag = {
    boolean: 0x01,
    integer: 0x02,
    octetString: 0x04,
    null: 0x05,
    enumerated: 0x0a,
    sequence: 0x30,
    set: 0x31
} as const

/**
 * The bit of a constructed tag
 */
export const CONSTRUCTED: number = 0x20

/**
 * The class bits of a tag: application and context-specific
 */
export const APPLICATION: number = 0x40
export const CONTEXT: number = 0x80

/**
 * A BER element that cannot be read: its tag, its length or its content
 */
export class BerError extends Error {
    public override readonly name: string = 'BerError'
}

/**
 * Whether bytes are valid UTF-8 (RFC 3629: no overlong forms, no surrogates, nothing above U+10FFFF). Checked here
 * rather than by a fatal TextDecoder, which Node.js built without ICU does not have, nor buffer.isUtf8 (Node.js 18.14).
 * @param bytes The bytes.
 * @param start Where to start.
 */
export function isUTF8(bytes: Uint8Array, start: number = 0): boolean {
    const length: number = bytes.length
    let index: number = start
    while (index < length) {
        const byte: number = bytes[index]
        if (byte < 0x80) {
            index++
            continue
        }
        let count: number
        let minimum: number
        let code: number
        if (byte >= 0xc2 && byte <= 0xdf) {
            count = 1
            minimum = 0x80
            code = byte & 0x1f
        } else if (byte >= 0xe0 && byte <= 0xef) {
            count = 2
            minimum = 0x800
            code = byte & 0x0f
        } else if (byte >= 0xf0 && byte <= 0xf4) {
            count = 3
            minimum = 0x10000
            code = byte & 0x07
        } else {
            return false
        }
        if (index + count >= length) return false
        for (let next: number = 1; next <= count; next++) {
            const continuation: number = bytes[index + next]
            if ((continuation & 0xc0) !== 0x80) return false
            code = (code << 6) | (continuation & 0x3f)
        }
        if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return false
        index += count + 1
    }
    return true
}

/**
 * Decode UTF-8 strictly: an invalid sequence is an error, not a replacement character
 * @param bytes The bytes.
 */
export function decodeUTF8(bytes: Buffer): string {
    for (let index: number = 0; index < bytes.length; index++) {
        if (bytes[index] >= 0x80) {
            if (!isUTF8(bytes, index)) throw new BerError('A string is not valid UTF-8')
            return bytes.toString('utf8')
        }
    }
    return bytes.toString('latin1')
}

/**
 * A reader of the elements in a range of a buffer
 */
export class BerReader {
    public offset: number

    public readonly end: number

    /**
     * @param buffer The buffer.
     * @param offset Where the elements start.
     * @param end Where they end.
     */
    constructor(public readonly buffer: Buffer, offset: number = 0, end: number = buffer.length) {
        this.offset = offset
        this.end = end
    }

    /**
     * The tag of the next element, or undefined at the end
     */
    public peek(): number | undefined {
        return this.offset < this.end ? this.buffer[this.offset] : undefined
    }

    /**
     * Whether the range is read
     */
    public atEnd(): boolean {
        return this.offset >= this.end
    }

    /**
     * Read the tag and the length of the next element, leaving the offset at its content
     * @param expected The tag it must have.
     * @returns The tag and the end of its content.
     */
    public header(expected?: number): {tag: number, end: number} {
        if (this.offset >= this.end) throw new BerError('An element is missing')
        const tag: number = this.buffer[this.offset++]
        if ((tag & 0x1f) === 0x1f) throw new BerError('A tag above 30')
        if (expected !== undefined && tag !== expected) throw new BerError(`Tag 0x${tag.toString(16)} where 0x${expected.toString(16)} is expected`)
        const length: number = this.length()
        const end: number = this.offset + length
        if (end > this.end) throw new BerError('An element longer than what holds it')
        return {tag: tag, end: end}
    }

    /**
     * Read a definite length
     */
    public length(): number {
        if (this.offset >= this.end) throw new BerError('A length is missing')
        const first: number = this.buffer[this.offset++]
        if (first < 0x80) return first
        if (first === 0x80) throw new BerError('An indefinite length')
        const count: number = first & 0x7f
        if (count > 4) throw new BerError('A length of more than 4 bytes')
        if (this.offset + count > this.end) throw new BerError('A length cut short')
        let length: number = 0
        for (let index: number = 0; index < count; index++) length = length * 256 + this.buffer[this.offset++]
        return length
    }

    /**
     * Enter a constructed element
     * @param expected The tag it must have.
     * @returns A reader of its content.
     */
    public enter(expected: number): BerReader {
        const {end} = this.header(expected)
        const reader: BerReader = new BerReader(this.buffer, this.offset, end)
        this.offset = end
        return reader
    }

    /**
     * Read the content of a primitive element
     * @param expected The tag it must have.
     */
    public content(expected: number): Buffer {
        const {end} = this.header(expected)
        const content: Buffer = this.buffer.subarray(this.offset, end)
        this.offset = end
        return content
    }

    /**
     * Skip the next element
     */
    public skip(): void {
        const {end} = this.header()
        this.offset = end
    }

    /**
     * Read an INTEGER (or an ENUMERATED, or another tag with an integer content)
     * @param expected The tag it must have.
     */
    public integer(expected: number = BerTag.integer): number {
        return integerOf(this.content(expected))
    }

    /**
     * Read an ENUMERATED
     * @param expected The tag it must have.
     */
    public enumerated(expected: number = BerTag.enumerated): number {
        return integerOf(this.content(expected))
    }

    /**
     * Read a BOOLEAN: any byte but zero is TRUE (X.690)
     * @param expected The tag it must have.
     */
    public boolean(expected: number = BerTag.boolean): boolean {
        const content: Buffer = this.content(expected)
        if (content.length !== 1) throw new BerError('A BOOLEAN of more than one byte')
        return content[0] !== 0
    }

    /**
     * Read an OCTET STRING, as a slice of the buffer
     * @param expected The tag it must have.
     */
    public octets(expected: number = BerTag.octetString): Buffer {
        return this.content(expected)
    }

    /**
     * Read an OCTET STRING holding UTF-8 (an LDAPString)
     * @param expected The tag it must have.
     */
    public string(expected: number = BerTag.octetString): string {
        return decodeUTF8(this.content(expected))
    }

    /**
     * Read a NULL
     * @param expected The tag it must have.
     */
    public null(expected: number = BerTag.null): void {
        if (this.content(expected).length) throw new BerError('A NULL with a content')
    }
}

/**
 * The value of an integer content (two's complement, big-endian), within the safe integers
 * @param content The content.
 */
export function integerOf(content: Buffer): number {
    if (!content.length) throw new BerError('An empty INTEGER')
    if (content.length > 6) throw new BerError('An INTEGER of more than 6 bytes')
    let value: number = content[0] & 0x80 ? content[0] - 256 : content[0]
    for (let index: number = 1; index < content.length; index++) value = value * 256 + content[index]
    return value
}

/**
 * An element to write: a primitive one with its content, or a constructed one with its children
 */
export interface BerElement {
    tag: number
    content?: Buffer
    children?: BerElement[]
    //The length of the content, set when the element is sized
    size?: number
}

/**
 * A primitive element
 * @param tag Its tag.
 * @param content Its content.
 */
export function primitive(tag: number, content: Buffer): BerElement {
    return {tag: tag, content: content}
}

/**
 * A constructed element
 * @param tag Its tag.
 * @param children Its children; the undefined ones are left out (the OPTIONAL elements absent).
 */
export function constructed(tag: number, children: (BerElement | undefined)[]): BerElement {
    return {tag: tag, children: children.filter((child: BerElement | undefined): child is BerElement => child !== undefined)}
}

/**
 * The minimal two's complement content of an integer
 * @param value The integer, within the safe integers.
 */
export function integerContent(value: number): Buffer {
    if (!Number.isSafeInteger(value)) throw new BerError(`${value} is not an integer`)
    const bytes: number[] = []
    let rest: number = value
    do {
        bytes.unshift(((rest % 256) + 256) % 256)
        rest = Math.floor(rest / 256)
    } while (rest !== 0 && rest !== -1)
    //The sign bit: a positive value whose first byte has it set gets a zero byte, a negative one without it a 0xFF byte
    if (value >= 0 && bytes[0] & 0x80) bytes.unshift(0)
    if (value < 0 && !(bytes[0] & 0x80)) bytes.unshift(0xff)
    return Buffer.from(bytes)
}

/**
 * An INTEGER element
 * @param value The integer.
 * @param tag Its tag.
 */
export function integer(value: number, tag: number = BerTag.integer): BerElement {
    return primitive(tag, integerContent(value))
}

/**
 * An ENUMERATED element
 * @param value The value.
 * @param tag Its tag.
 */
export function enumerated(value: number, tag: number = BerTag.enumerated): BerElement {
    return primitive(tag, integerContent(value))
}

const TRUE: Buffer = Buffer.from([0xff])
const FALSE: Buffer = Buffer.from([0x00])
const EMPTY: Buffer = Buffer.alloc(0)

/**
 * A BOOLEAN element
 * @param value The value.
 * @param tag Its tag.
 */
export function boolean(value: boolean, tag: number = BerTag.boolean): BerElement {
    return primitive(tag, value ? TRUE : FALSE)
}

/**
 * An OCTET STRING element; a string is written in UTF-8
 * @param value The bytes or the string.
 * @param tag Its tag.
 */
export function octets(value: Buffer | Uint8Array | string, tag: number = BerTag.octetString): BerElement {
    return primitive(tag, typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength))
}

/**
 * A NULL element
 * @param tag Its tag.
 */
export function nullElement(tag: number = BerTag.null): BerElement {
    return primitive(tag, EMPTY)
}

/**
 * The bytes a length takes
 * @param length The length.
 */
function lengthSize(length: number): number {
    if (length < 0x80) return 1
    if (length <= 0xff) return 2
    if (length <= 0xffff) return 3
    if (length <= 0xffffff) return 4
    return 5
}

/**
 * Size an element and its children, returning the bytes it takes
 * @param element The element.
 */
function measure(element: BerElement): number {
    let size: number = 0
    if (element.children) {
        for (const child of element.children) size += measure(child)
    } else {
        size = element.content!.length
    }
    element.size = size
    return 1 + lengthSize(size) + size
}

/**
 * Write a sized element at an offset, returning the offset after it
 * @param element The element.
 * @param target The buffer.
 * @param offset The offset.
 */
function write(element: BerElement, target: Buffer, offset: number): number {
    const size: number = element.size!
    target[offset++] = element.tag
    if (size < 0x80) {
        target[offset++] = size
    } else {
        const count: number = lengthSize(size) - 1
        target[offset++] = 0x80 | count
        for (let index: number = count - 1; index >= 0; index--) target[offset++] = Math.floor(size / 256 ** index) % 256
    }
    if (element.children) {
        for (const child of element.children) offset = write(child, target, offset)
    } else {
        element.content!.copy(target, offset)
        offset += size
    }
    return offset
}

/**
 * Write an element into a buffer of its own
 * @param element The element.
 */
export function serialize(element: BerElement): Buffer {
    const target: Buffer = Buffer.allocUnsafe(measure(element))
    write(element, target, 0)
    return target
}
