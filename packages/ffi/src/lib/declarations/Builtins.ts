import type {Platform} from './Platform.js'
import type {CallingConvention, CType, Direction, PrimitiveName, RecordType} from './Types.js'

const primitive = (name: PrimitiveName): CType => ({kind: 'primitive', name: name})
const pointer = (to: CType, constTarget: boolean = false): CType => ({kind: 'pointer', to: to, constTarget: constTarget})

/**
 * The opaque FILE of the C library, the same object for every library: the pointers of two libraries are the same type
 */
const FILE: RecordType = {kind: 'struct', tag: 'FILE'}

/**
 * The va_list of the variadic functions: declared, it cannot be passed (the functions taking one are for C callers)
 */
const VA_LIST: RecordType = {kind: 'struct', tag: 'va_list'}

/**
 * The GUID of Windows (UUID, CLSID, IID)
 */
const GUID: RecordType = {
    kind: 'struct',
    tag: '_GUID',
    members: [
        {name: 'Data1', type: primitive('uint32')},
        {name: 'Data2', type: primitive('uint16')},
        {name: 'Data3', type: primitive('uint16')},
        {name: 'Data4', type: {kind: 'array', of: primitive('uint8'), length: 8}}
    ]
}

/**
 * The handles of Windows: pointers to nothing known
 */
const HANDLES: readonly string[] = [
    'HANDLE', 'HWND', 'HINSTANCE', 'HMODULE', 'HKEY', 'HDC', 'HGLOBAL', 'HLOCAL', 'HMENU', 'HICON', 'HBITMAP', 'HBRUSH',
    'HFONT', 'HPEN', 'HRGN', 'HCURSOR', 'HMONITOR', 'HRSRC', 'HGDIOBJ', 'HACCEL', 'HDESK', 'HWINSTA', 'HHOOK', 'HEVENT',
    'HKL', 'HPALETTE', 'HDROP', 'HDEVINFO', 'SC_HANDLE', 'SERVICE_STATUS_HANDLE', 'PSID', 'HCRYPTPROV'
]

/**
 * The types every declaration knows without declaring them: the ones of stdint.h and stddef.h, the ones of POSIX with
 * their size on the platform, the ones of the Windows API (the same on every platform: DWORD is 32-bit everywhere).
 * A declaration of the same name replaces them
 * @param platform
 */
export function builtinTypes(platform: Platform): Map<string, CType> {
    const windows: boolean = platform.os === 'win32'
    const darwin: boolean = platform.os === 'darwin'
    const types: Map<string, CType> = new Map()
    const set = (names: string | readonly string[], type: CType): void => {
        for (const name of typeof names === 'string' ? [names] : names) types.set(name, type)
    }
    //stdint.h, stddef.h, uchar.h, stdbool.h
    for (const bits of [8, 16, 32, 64]) {
        set([`int${bits}_t`, `int_least${bits}_t`, `int_fast${bits}_t`, `__int${bits}_t`], primitive(`int${bits}` as PrimitiveName))
        set([`uint${bits}_t`, `uint_least${bits}_t`, `uint_fast${bits}_t`, `__uint${bits}_t`, `u_int${bits}_t`], primitive(`uint${bits}` as PrimitiveName))
    }
    set(['intmax_t'], primitive('int64'))
    set(['uintmax_t'], primitive('uint64'))
    set(['size_t', 'rsize_t'], primitive('size'))
    set(['ssize_t'], primitive('ssize'))
    set(['intptr_t'], primitive('intptr'))
    set(['uintptr_t'], primitive('uintptr'))
    set(['ptrdiff_t'], primitive('ptrdiff'))
    set(['wchar_t'], primitive('wchar'))
    set(['char16_t'], primitive('char16'))
    set(['char32_t'], primitive('char32'))
    set(['bool'], primitive('bool'))
    //POSIX, with their size on the platform
    set(['time_t'], primitive(windows ? 'int64' : 'long'))
    set(['suseconds_t'], primitive(darwin ? 'int32' : 'long'))
    set(['useconds_t'], primitive('uint32'))
    set(['off_t'], primitive(darwin ? 'int64' : 'long'))
    set(['clock_t'], primitive(darwin ? 'ulong' : 'long'))
    set(['pid_t'], primitive('int32'))
    set(['uid_t', 'gid_t', 'socklen_t'], primitive('uint32'))
    set(['mode_t'], primitive(darwin ? 'uint16' : 'uint32'))
    set(['FILE'], FILE)
    set(['va_list', '__builtin_va_list', '__gnuc_va_list', '__darwin_va_list', '__va_list'], VA_LIST)
    //The BSD types (sys/types.h)
    set(['u_char'], primitive('uint8'))
    set(['u_short'], primitive('uint16'))
    set(['u_int'], primitive('uint32'))
    set(['u_long'], primitive('ulong'))
    set(['u_quad_t'], primitive('uint64'))
    set(['quad_t'], primitive('int64'))
    set(['caddr_t'], pointer(primitive('char')))
    //The Windows API
    set(['BYTE', 'UCHAR', 'BOOLEAN', 'UINT8'], primitive('uint8'))
    set(['CHAR', 'CCHAR'], primitive('char'))
    set(['INT8'], primitive('int8'))
    set(['WCHAR'], primitive('char16'))
    set(['SHORT', 'INT16'], primitive('int16'))
    set(['USHORT', 'WORD', 'ATOM', 'LANGID', 'UINT16'], primitive('uint16'))
    set(['INT', 'LONG', 'BOOL', 'HRESULT', 'NTSTATUS', 'LONG32', 'INT32', 'HFILE'], primitive('int32'))
    set(['UINT', 'ULONG', 'DWORD', 'DWORD32', 'ULONG32', 'UINT32', 'COLORREF', 'LCID'], primitive('uint32'))
    set(['LONGLONG', 'LONG64', 'INT64'], primitive('int64'))
    set(['ULONGLONG', 'DWORDLONG', 'QWORD', 'DWORD64', 'ULONG64', 'UINT64'], primitive('uint64'))
    set(['FLOAT'], primitive('float'))
    set(['DOUBLE'], primitive('double'))
    set(['INT_PTR', 'LONG_PTR', 'LPARAM', 'LRESULT', 'SSIZE_T'], primitive('intptr'))
    set(['UINT_PTR', 'ULONG_PTR', 'DWORD_PTR', 'WPARAM', 'SIZE_T'], primitive('uintptr'))
    set(HANDLES, pointer(primitive('void')))
    set(['PVOID', 'LPVOID'], pointer(primitive('void')))
    set(['LPCVOID', 'PCVOID'], pointer(primitive('void'), true))
    set(['LPSTR', 'PSTR', 'PCHAR'], pointer(primitive('char')))
    set(['LPCSTR', 'PCSTR'], pointer(primitive('char'), true))
    set(['LPWSTR', 'PWSTR', 'PWCHAR'], pointer(primitive('char16')))
    set(['LPCWSTR', 'PCWSTR'], pointer(primitive('char16'), true))
    set(['LPBYTE', 'PBYTE', 'PUCHAR', 'PBOOLEAN'], pointer(primitive('uint8')))
    set(['LPWORD', 'PWORD', 'PUSHORT'], pointer(primitive('uint16')))
    set(['LPDWORD', 'PDWORD', 'PULONG', 'PUINT', 'LPUINT'], pointer(primitive('uint32')))
    set(['LPLONG', 'PLONG', 'LPINT', 'PINT', 'LPBOOL', 'PBOOL'], pointer(primitive('int32')))
    set(['PULONGLONG', 'PDWORD64'], pointer(primitive('uint64')))
    set(['PLONGLONG'], pointer(primitive('int64')))
    set(['PSIZE_T', 'PULONG_PTR', 'PDWORD_PTR'], pointer(primitive('uintptr')))
    set(['PHANDLE', 'LPHANDLE'], pointer(pointer(primitive('void'))))
    set(['GUID', 'UUID', 'CLSID', 'IID'], GUID)
    return types
}

/**
 * The words naming a calling convention: the keywords of the compilers, the macros of the Windows API
 */
export const CONVENTIONS: ReadonlyMap<string, CallingConvention> = new Map([
    ['__cdecl', 'cdecl'], ['_cdecl', 'cdecl'], ['__stdcall', 'stdcall'], ['_stdcall', 'stdcall'],
    ['__fastcall', 'fastcall'], ['_fastcall', 'fastcall'], ['__thiscall', 'thiscall'],
    ['WINAPI', 'stdcall'], ['APIENTRY', 'stdcall'], ['CALLBACK', 'stdcall'], ['PASCAL', 'stdcall'], ['NTAPI', 'stdcall'],
    ['STDMETHODCALLTYPE', 'stdcall'], ['STDAPICALLTYPE', 'stdcall'], ['WINAPIV', 'cdecl'], ['CDECL', 'cdecl']
])

/**
 * The words read and ignored where qualifiers go: the qualifiers that do not change how a value is passed, the macros of
 * the Windows API that are empty
 */
export const IGNORED: ReadonlySet<string> = new Set([
    'volatile', 'restrict', '__restrict', '__restrict__', '_Nullable', '_Nonnull', '_Null_unspecified', '__nullable',
    '__nonnull', '__null_unspecified', '_Nullable_result', '__unaligned', '__ptr32', '__ptr64', '__w64', '__sptr', '__uptr',
    'FAR', 'NEAR', 'far', 'near', 'OPTIONAL', 'register', 'auto', '__extension__', '_Noreturn', 'noreturn', '__volatile__',
    '__kindof', '__cdecl__', '__weak', '__strong', '__autoreleasing', '__unsafe_unretained'
])

/**
 * The words read as const
 */
export const CONSTS: ReadonlySet<string> = new Set(['const', '__const', '__const__', 'CONST'])

/**
 * The words of inline functions, whose bodies are skipped
 */
export const INLINES: ReadonlySet<string> = new Set(['inline', '__inline', '__inline__', '__forceinline', '_inline', 'FORCEINLINE'])

/**
 * The prefixes of the annotations of Microsoft (SAL): a word starting with one, not declared as a type, is an
 * annotation, its arguments in parentheses skipped
 */
const SAL_PREFIXES: readonly string[] = [
    '_In_', '_Out', '_Inout', '_COM_Outptr', '_Ret_', '_Success_', '_Check_return_', '_Must_inspect_result_',
    '_Printf_format_string_', '_Scanf_format_string_', '_Field_', '_Frees_ptr_', '_Pre_', '_Post_', '_Deref_', '_Reserved_',
    '_Null_terminated_', '_NullNull_terminated_', '_Use_decl_annotations_', '_When_', '_At_', '_At_buffer_', '_Always_',
    '_Return_type_success_', '_Struct_size_bytes_', '_Readable_', '_Writable_', '__drv_', '_IRQL_', '_Kernel_',
    '_Function_class_', '_Callback_', '_Notnull_', '_Maybenull_', '_Const_', '_Translates_', '_Points_to_data_',
    '_Literal_', '_Notliteral_', '_Strict_type_match_', '_Analysis_', '_Acquires_', '_Releases_', '_Requires_', '_Guarded_by_',
    '_Interlocked_', '_Inexpressible_', '_Pre_satisfies_', '_Outref_', '_Ret_maybenull_', '_Result_', '_Group_', '_On_failure_'
]

/**
 * The direction an annotation gives a parameter, if it is one: the ones of Microsoft (_Out_, _Inout_opt_,
 * _Outptr_result_maybenull_…) and the macros IN and OUT of the Windows API; null for an annotation that gives none,
 * undefined for a word that is not an annotation
 * @param word
 */
export function annotationDirection(word: string): Direction | null | undefined {
    if (word === 'IN') return 'in'
    if (word === 'OUT') return 'out'
    if (!SAL_PREFIXES.some((prefix: string): boolean => word.startsWith(prefix)) && !['_In_', '_Out_', '_Inout_'].includes(word)) return undefined
    if (word.startsWith('_Inout')) return 'inout'
    if (word.startsWith('_Out') || word.startsWith('_COM_Outptr')) return 'out'
    if (word.startsWith('_In_')) return 'in'
    return null
}
