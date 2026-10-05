import {readFileSync} from 'node:fs'
import {release} from 'node:os'

/*
 * The default profile of seccomp of the containers, the one of containerd (contrib/seccomp, see THIRD_PARTY_NOTICES.md)
 * which nerdctl gives them: the system calls allowed, the other ones refused (EPERM), the ones of the capabilities of
 * the container allowed with them
 */

/**
 * A rule of a profile of seccomp (OCI)
 */
export type SeccompSyscall = {
    names: string[]
    action: string
    errnoRet?: number
    args?: { index: number, value: number, valueTwo?: number, op: string }[]
}

/**
 * A profile of seccomp (the linux.seccomp of the specification of OCI)
 */
export type SeccompProfile = {
    defaultAction: string
    defaultErrnoRet?: number
    architectures?: string[]
    flags?: string[]
    syscalls?: SeccompSyscall[]
}

const ALLOWED: readonly string[] = [
    'accept', 'accept4', 'access', 'adjtimex', 'alarm', 'bind', 'brk', 'cachestat', 'capget', 'capset', 'chdir', 'chmod',
    'chown', 'chown32', 'clock_adjtime', 'clock_adjtime64', 'clock_getres', 'clock_getres_time64', 'clock_gettime',
    'clock_gettime64', 'clock_nanosleep', 'clock_nanosleep_time64', 'close', 'close_range', 'connect', 'copy_file_range',
    'creat', 'dup', 'dup2', 'dup3', 'epoll_create', 'epoll_create1', 'epoll_ctl', 'epoll_ctl_old', 'epoll_pwait',
    'epoll_pwait2', 'epoll_wait', 'epoll_wait_old', 'eventfd', 'eventfd2', 'execve', 'execveat', 'exit', 'exit_group',
    'faccessat', 'faccessat2', 'fadvise64', 'fadvise64_64', 'fallocate', 'fanotify_mark', 'fchdir', 'fchmod', 'fchmodat',
    'fchmodat2', 'fchown', 'fchown32', 'fchownat', 'fcntl', 'fcntl64', 'fdatasync', 'fgetxattr', 'flistxattr', 'flock',
    'fork', 'fremovexattr', 'fsetxattr', 'fstat', 'fstat64', 'fstatat64', 'fstatfs', 'fstatfs64', 'fsync', 'ftruncate',
    'ftruncate64', 'futex', 'futex_requeue', 'futex_time64', 'futex_wait', 'futex_waitv', 'futex_wake', 'futimesat',
    'getcpu', 'getcwd', 'getdents', 'getdents64', 'getegid', 'getegid32', 'geteuid', 'geteuid32', 'getgid', 'getgid32',
    'getgroups', 'getgroups32', 'getitimer', 'getpeername', 'getpgid', 'getpgrp', 'getpid', 'getppid', 'getpriority',
    'getrandom', 'getresgid', 'getresgid32', 'getresuid', 'getresuid32', 'getrlimit', 'get_robust_list', 'getrusage',
    'getsid', 'getsockname', 'getsockopt', 'get_thread_area', 'gettid', 'gettimeofday', 'getuid', 'getuid32', 'getxattr',
    'inotify_add_watch', 'inotify_init', 'inotify_init1', 'inotify_rm_watch', 'io_cancel', 'ioctl', 'io_destroy',
    'io_getevents', 'io_pgetevents', 'io_pgetevents_time64', 'ioprio_get', 'ioprio_set', 'io_setup', 'io_submit',
    'io_uring_enter', 'io_uring_register', 'io_uring_setup', 'ipc', 'kill', 'landlock_add_rule', 'landlock_create_ruleset',
    'landlock_restrict_self', 'lchown', 'lchown32', 'lgetxattr', 'link', 'linkat', 'listen', 'listxattr', 'llistxattr',
    '_llseek', 'lremovexattr', 'lseek', 'lsetxattr', 'lstat', 'lstat64', 'madvise', 'membarrier', 'memfd_create',
    'memfd_secret', 'mincore', 'mkdir', 'mkdirat', 'mknod', 'mknodat', 'mlock', 'mlock2', 'mlockall', 'map_shadow_stack',
    'mmap', 'mmap2', 'mprotect', 'mq_getsetattr', 'mq_notify', 'mq_open', 'mq_timedreceive', 'mq_timedreceive_time64',
    'mq_timedsend', 'mq_timedsend_time64', 'mq_unlink', 'mremap', 'msgctl', 'msgget', 'msgrcv', 'msgsnd', 'msync',
    'munlock', 'munlockall', 'munmap', 'name_to_handle_at', 'nanosleep', 'newfstatat', '_newselect', 'open', 'openat',
    'openat2', 'pause', 'pidfd_open', 'pidfd_send_signal', 'pipe', 'pipe2', 'pkey_alloc', 'pkey_free', 'pkey_mprotect',
    'poll', 'ppoll', 'ppoll_time64', 'prctl', 'pread64', 'preadv', 'preadv2', 'prlimit64', 'process_mrelease', 'pselect6',
    'pselect6_time64', 'pwrite64', 'pwritev', 'pwritev2', 'read', 'readahead', 'readlink', 'readlinkat', 'readv', 'recv',
    'recvfrom', 'recvmmsg', 'recvmmsg_time64', 'recvmsg', 'remap_file_pages', 'removexattr', 'rename', 'renameat',
    'renameat2', 'restart_syscall', 'rmdir', 'rseq', 'rt_sigaction', 'rt_sigpending', 'rt_sigprocmask', 'rt_sigqueueinfo',
    'rt_sigreturn', 'rt_sigsuspend', 'rt_sigtimedwait', 'rt_sigtimedwait_time64', 'rt_tgsigqueueinfo', 'sched_getaffinity',
    'sched_getattr', 'sched_getparam', 'sched_get_priority_max', 'sched_get_priority_min', 'sched_getscheduler',
    'sched_rr_get_interval', 'sched_rr_get_interval_time64', 'sched_setaffinity', 'sched_setattr', 'sched_setparam',
    'sched_setscheduler', 'sched_yield', 'seccomp', 'select', 'semctl', 'semget', 'semop', 'semtimedop',
    'semtimedop_time64', 'send', 'sendfile', 'sendfile64', 'sendmmsg', 'sendmsg', 'sendto', 'setfsgid', 'setfsgid32',
    'setfsuid', 'setfsuid32', 'setgid', 'setgid32', 'setgroups', 'setgroups32', 'setitimer', 'setpgid', 'setpriority',
    'setregid', 'setregid32', 'setresgid', 'setresgid32', 'setresuid', 'setresuid32', 'setreuid', 'setreuid32',
    'setrlimit', 'set_robust_list', 'setsid', 'setsockopt', 'set_thread_area', 'set_tid_address', 'setuid', 'setuid32',
    'setxattr', 'shmat', 'shmctl', 'shmdt', 'shmget', 'shutdown', 'sigaltstack', 'signalfd', 'signalfd4', 'sigprocmask',
    'sigreturn', 'socketcall', 'socketpair', 'splice', 'stat', 'stat64', 'statfs', 'statfs64', 'statx', 'symlink',
    'symlinkat', 'sync', 'sync_file_range', 'syncfs', 'sysinfo', 'tee', 'tgkill', 'time', 'timer_create', 'timer_delete',
    'timer_getoverrun', 'timer_gettime', 'timer_gettime64', 'timer_settime', 'timer_settime64', 'timerfd_create',
    'timerfd_gettime', 'timerfd_gettime64', 'timerfd_settime', 'timerfd_settime64', 'times', 'tkill', 'truncate',
    'truncate64', 'ugetrlimit', 'umask', 'uname', 'unlink', 'unlinkat', 'utime', 'utimensat', 'utimensat_time64', 'utimes',
    'vfork', 'vmsplice', 'wait4', 'waitid', 'waitpid', 'write', 'writev'
]

/**
 * The architectures of the system calls filtered, by the architecture of the machine (the emulated containers run its
 * system calls: their emulators are processes of the machine)
 */
const ARCHITECTURES: Readonly<Record<string, string[]>> = {
    x64: ['SCMP_ARCH_X86_64', 'SCMP_ARCH_X86', 'SCMP_ARCH_X32'],
    arm64: ['SCMP_ARCH_ARM', 'SCMP_ARCH_AARCH64'],
    mips64: ['SCMP_ARCH_MIPS', 'SCMP_ARCH_MIPS64', 'SCMP_ARCH_MIPS64N32'],
    mips64el: ['SCMP_ARCH_MIPSEL', 'SCMP_ARCH_MIPSEL64', 'SCMP_ARCH_MIPSEL64N32'],
    s390x: ['SCMP_ARCH_S390', 'SCMP_ARCH_S390X'],
    riscv64: ['SCMP_ARCH_RISCV64']
}

/**
 * The system calls of the architectures of the machine
 */
const ARCHITECTURE_SYSCALLS: Readonly<Record<string, string[]>> = {
    ppc64: ['sync_file_range2', 'swapcontext'],
    arm: ['arm_fadvise64_64', 'arm_sync_file_range', 'sync_file_range2', 'breakpoint', 'cacheflush', 'set_tls'],
    arm64: ['arm_fadvise64_64', 'arm_sync_file_range', 'sync_file_range2', 'breakpoint', 'cacheflush', 'set_tls'],
    x64: ['arch_prctl', 'modify_ldt'],
    ia32: ['modify_ldt'],
    s390x: ['s390_pci_mmio_read', 's390_pci_mmio_write', 's390_runtime_instr'],
    riscv64: ['riscv_flush_icache']
}

/**
 * The system calls allowed with the capabilities
 */
const CAPABILITY_SYSCALLS: Readonly<Record<string, string[]>> = {
    CAP_DAC_READ_SEARCH: ['open_by_handle_at'],
    CAP_SYS_ADMIN: [
        'bpf', 'clone', 'clone3', 'fanotify_init', 'fsconfig', 'fsmount', 'fsopen', 'fspick', 'lookup_dcookie', 'mount',
        'mount_setattr', 'move_mount', 'open_tree', 'perf_event_open', 'quotactl', 'quotactl_fd', 'setdomainname',
        'sethostname', 'setns', 'syslog', 'umount', 'umount2', 'unshare'
    ],
    CAP_SYS_BOOT: ['reboot'],
    CAP_SYS_CHROOT: ['chroot'],
    CAP_SYS_MODULE: ['delete_module', 'init_module', 'finit_module'],
    CAP_SYS_PACCT: ['acct'],
    CAP_SYS_PTRACE: ['kcmp', 'pidfd_getfd', 'process_madvise', 'process_vm_readv', 'process_vm_writev', 'ptrace'],
    CAP_SYS_RAWIO: ['iopl', 'ioperm'],
    CAP_SYS_TIME: ['settimeofday', 'stime', 'clock_settime', 'clock_settime64'],
    CAP_SYS_TTY_CONFIG: ['vhangup'],
    CAP_SYS_NICE: ['get_mempolicy', 'mbind', 'set_mempolicy', 'set_mempolicy_home_node'],
    CAP_SYSLOG: ['syslog'],
    CAP_BPF: ['bpf'],
    CAP_PERFMON: ['perf_event_open']
}

const AF_VSOCK: number = 40

const ENOSYS: number = 38

/**
 * The flags of clone creating namespaces (NEWNS, NEWUTS, NEWIPC, NEWUSER, NEWPID, NEWNET, NEWCGROUP)
 */
const CLONE_NAMESPACES: number = 0x00020000 | 0x04000000 | 0x08000000 | 0x10000000 | 0x20000000 | 0x40000000 | 0x02000000

/**
 * Whether a release of Linux (6.1.0-13-arm64) is at least a version
 * @param kernel
 * @param major
 * @param minor
 */
function kernelAtLeast(kernel: string, major: number, minor: number): boolean {
    const match: RegExpMatchArray | null = kernel.match(/^(\d+)\.(\d+)/)
    if (!match) return false
    return Number(match[1]) > major || (Number(match[1]) === major && Number(match[2]) >= minor)
}

/**
 * Whether the kernel filters the system calls (the Seccomp field of the status of the processes)
 * @param status the status of a process
 */
export function seccompSupported(status?: string): boolean {
    try {
        return /^Seccomp:/m.test(status ?? readFileSync('/proc/self/status', 'utf8'))
    } catch {
        return false
    }
}

/**
 * The default profile of seccomp of a container, by its capabilities (its bounding set)
 * @param capabilities
 * @param arch the architecture of the machine, as Node.js names it
 * @param kernel the release of its kernel
 */
export function defaultSeccompProfile(capabilities: string[], arch: string = process.arch, kernel: string = release()): SeccompProfile {
    const allow = (names: string[], args?: SeccompSyscall['args']): SeccompSyscall => ({names: names, action: 'SCMP_ACT_ALLOW', args: args ?? []})
    const syscalls: SeccompSyscall[] = [
        allow([...ALLOWED]),
        allow(['socket'], [{index: 0, value: AF_VSOCK, op: 'SCMP_CMP_NE'}]),
        ...[0x0, 0x0008, 0x20000, 0x20008, 0xffffffff].map((value: number): SeccompSyscall => allow(['personality'], [{index: 0, value: value, op: 'SCMP_CMP_EQ'}]))
    ]
    if (kernelAtLeast(kernel, 4, 8)) syscalls.push(allow(['process_vm_readv', 'process_vm_writev', 'ptrace']))
    if (ARCHITECTURE_SYSCALLS[arch]) syscalls.push(allow([...ARCHITECTURE_SYSCALLS[arch]]))
    for (const capability of capabilities) {
        if (CAPABILITY_SYSCALLS[capability]) syscalls.push(allow([...CAPABILITY_SYSCALLS[capability]]))
    }
    if (!capabilities.includes('CAP_SYS_ADMIN')) {
        //clone without the flags creating namespaces (its second argument on s390x)
        syscalls.push(allow(['clone'], [{index: arch === 's390x' ? 1 : 0, value: CLONE_NAMESPACES, valueTwo: 0, op: 'SCMP_CMP_MASKED_EQ'}]))
        //clone3 refused with ENOSYS: the C libraries fall back to clone
        syscalls.push({names: ['clone3'], action: 'SCMP_ACT_ERRNO', errnoRet: ENOSYS})
    }
    return {defaultAction: 'SCMP_ACT_ERRNO', architectures: [...ARCHITECTURES[arch] ?? []], syscalls: syscalls}
}
