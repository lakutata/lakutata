//The process exiting while asynchronous native calls run: no crash expected (verified in Node.js, Bun and Electron), in
//the thread pool and in the worker threads of the library. Not a unit test: a check to run again when koffi or Bun is
//upgraded.
//   npm run compile && node test-env/crash/exit.mjs [natural] [threads]
//   bun test-env/crash/exit.mjs [natural] [threads]
//With "natural", the process does not call process.exit: it ends once its event loop is empty; with "threads", the
//calls run in the worker threads of the library (threads: 1), started before. Exiting while they start (they load
//koffi) can crash, as stopping a worker then does: see the mode starting of terminate.mjs.
import {loadNativeLibrary} from '../../dist/esm/exports/FFI.js'

const threads = process.argv.includes('threads') ? 1 : 0
const library = process.platform === 'win32' ? loadNativeLibrary('kernel32', '', {threads: threads}) : loadNativeLibrary('c', '', {threads: threads})
const sleep = process.platform === 'win32'
    ? library.func('void WINAPI Sleep(DWORD milliseconds)', {async: true})
    : (usleep => milliseconds => usleep(Math.round(milliseconds * 1000)))(library.func('int usleep(uint32_t microseconds)', {async: true}))
await library.ready
for (let i = 0; i < 4; i++) sleep(Math.random() * 20)
if (!process.argv.includes('natural')) setTimeout(() => process.exit(0), Math.random() * 20)
