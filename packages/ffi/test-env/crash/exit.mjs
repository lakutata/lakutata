//The process exiting while asynchronous native calls run on the main thread: no crash expected (verified in Node.js,
//Bun and Electron). Not a unit test: a check to run again when koffi or Bun is upgraded.
//   npm run compile && node test-env/crash/exit.mjs [natural]
//   bun test-env/crash/exit.mjs [natural]
//With "natural", the process does not call process.exit: it ends once its event loop is empty.
import {loadNativeLibrary} from '../../dist/esm/exports/FFI.js'

const sleep = process.platform === 'win32'
    ? loadNativeLibrary('kernel32').func('void WINAPI Sleep(DWORD milliseconds)', {async: true})
    : (milliseconds => loadNativeLibrary('c').func('int usleep(uint32_t microseconds)', {async: true})(Math.round(milliseconds * 1000)))
for (let i = 0; i < 4; i++) sleep(Math.random() * 20)
if (process.argv[2] !== 'natural') setTimeout(() => process.exit(0), Math.random() * 20)
