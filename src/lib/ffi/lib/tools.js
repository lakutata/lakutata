// Copyright 2023 Niels Martignène <niels.martignene@protonmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the “Software”), to deal in
// the Software without restriction, including without limitation the rights to use,
// copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
// Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
// OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
// HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
// WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
// OTHER DEALINGS IN THE SOFTWARE.

'use strict'

const fs = require('fs')

function determine_arch() {
    let arch = process.arch

    if (arch == 'riscv32' || arch == 'riscv64') {
        let buf = read_file_header(process.execPath, 512)
        let header = decode_elf_header(buf)
        let float_abi = (header.e_flags & 0x6) >> 1

        switch (float_abi) {
            case 0: {
                arch += 'sf'
            }
                break
            case 1: {
                arch += 'hf32'
            }
                break
            case 2: {
                arch += 'hf64'
            }
                break
            case 3: {
                arch += 'hf128'
            }
                break
        }
    } else if (arch == 'arm') {
        arch = 'arm32'

        let buf = read_file_header(process.execPath, 512)
        let header = decode_elf_header(buf)

        if (header.e_flags & 0x400) {
            arch += 'hf'
        } else if (header.e_flags & 0x200) {
            arch += 'sf'
        } else {
            throw new Error('Unknown ARM floating-point ABI')
        }
    }

    return arch
}

function read_file_header(filename, read) {
    let fd = null

    try {
        let fd = fs.openSync(filename)

        let buf = Buffer.allocUnsafe(read)
        let len = fs.readSync(fd, buf)

        return buf.subarray(0, len)
    } finally {
        if (fd != null)
            fs.closeSync(fd)
    }
}

function decode_elf_header(buf) {
    let header = {}

    if (buf.length < 16)
        throw new Error('Truncated header')
    if (buf[0] != 0x7F || buf[1] != 69 || buf[2] != 76 || buf[3] != 70)
        throw new Error('Invalid magic number')
    if (buf[6] != 1)
        throw new Error('Invalid ELF version')
    if (buf[5] != 1)
        throw new Error('Big-endian architectures are not supported')

    let machine = buf.readUInt16LE(18)

    switch (machine) {
        case 3: {
            header.e_machine = 'ia32'
        }
            break
        case 40: {
            header.e_machine = 'arm'
        }
            break
        case 62: {
            header.e_machine = 'amd64'
        }
            break
        case 183: {
            header.e_machine = 'arm64'
        }
            break
        case 243: {
            switch (buf[4]) {
                case 1: {
                    header.e_machine = 'riscv32'
                }
                    break
                case 2: {
                    header.e_machine = 'riscv64'
                }
                    break
            }
        }
            break
        default:
            throw new Error('Unknown ELF machine type')
    }

    switch (buf[4]) {
        case 1: { // 32 bit
            buf = buf.subarray(0, 68)
            if (buf.length < 68)
                throw new Error('Truncated ELF header')

            header.ei_class = 32
            header.e_flags = buf.readUInt32LE(36)
        }
            break
        case 2: { // 64 bit
            buf = buf.subarray(0, 120)
            if (buf.length < 120)
                throw new Error('Truncated ELF header')

            header.ei_class = 64
            header.e_flags = buf.readUInt32LE(48)
        }
            break
        default:
            throw new Error('Invalid ELF class')
    }

    return header
}

function get_napi_version(napi, major) {
    if (napi > 8)
        return null

    // https://nodejs.org/api/n-api.html#node-api-version-matrix
    const support = {
        6: ['6.14.2', '6.14.2', '6.14.2'],
        8: ['8.6.0', '8.10.0', '8.11.2'],
        9: ['9.0.0', '9.3.0', '9.11.0'],
        10: ['10.0.0', '10.0.0', '10.0.0', '10.16.0', '10.17.0', '10.20.0', '10.23.0'],
        11: ['11.0.0', '11.0.0', '11.0.0', '11.8.0'],
        12: ['12.0.0', '12.0.0', '12.0.0', '12.0.0', '12.11.0', '12.17.0', '12.19.0', '12.22.0'],
        13: ['13.0.0', '13.0.0', '13.0.0', '13.0.0', '13.0.0'],
        14: ['14.0.0', '14.0.0', '14.0.0', '14.0.0', '14.0.0', '14.0.0', '14.12.0', '14.17.0'],
        15: ['15.0.0', '15.0.0', '15.0.0', '15.0.0', '15.0.0', '15.0.0', '15.0.0', '15.12.0']
    }
    const max = Math.max(...Object.keys(support).map(k => parseInt(k, 10)))

    if (major > max)
        return major + '.0.0'
    if (support[major] == null)
        return null

    let required = support[major][napi - 1] || null
    return required
}

module.exports = {
    determine_arch,
    get_napi_version
}
