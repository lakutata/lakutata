#ifdef _WIN32

#include "Port.h"

#include <chrono>
#include <cstring>
#include <string>
#include <thread>
#include <setupapi.h>
#include <devguid.h>

namespace serial {

    namespace {
        constexpr DWORD SLICE = 100;

        [[noreturn]] void fail(const char *syscall, DWORD code = GetLastError()) {
            throw Failure{static_cast<long>(code), syscall, ""};
        }

        std::wstring wide(const std::string &text) {
            if (text.empty()) return L"";
            const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
            std::wstring result(static_cast<size_t>(size), L'\0');
            MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size);
            return result;
        }

        std::string narrow(const wchar_t *text) {
            if (!text || !*text) return "";
            const int size = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
            std::string result(static_cast<size_t>(size), '\0');
            WideCharToMultiByte(CP_UTF8, 0, text, -1, result.data(), size, nullptr, nullptr);
            result.resize(static_cast<size_t>(size > 0 ? size - 1 : 0));
            return result;
        }

        /**
         * An overlapped operation waited for in slices, cancelled when the port is closed: true once it ended, false
         * when it was cancelled
         */
        bool waited(Port &port, OVERLAPPED &overlapped, DWORD &transferred, const char *syscall) {
            for (;;) {
                const DWORD result = WaitForSingleObject(overlapped.hEvent, SLICE);
                if (result == WAIT_OBJECT_0) break;
                if (result != WAIT_TIMEOUT) fail("WaitForSingleObject");
                if (port.closing) {
                    CancelIoEx(port.handle, &overlapped);
                    GetOverlappedResult(port.handle, &overlapped, &transferred, TRUE);
                    return false;
                }
            }
            if (!GetOverlappedResult(port.handle, &overlapped, &transferred, FALSE)) {
                const DWORD error = GetLastError();
                if (error == ERROR_OPERATION_ABORTED) return false;
                fail(syscall, error);
            }
            return true;
        }

        struct Event {
            OVERLAPPED overlapped = {};

            Event() {
                overlapped.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
                if (!overlapped.hEvent) fail("CreateEvent");
            }

            ~Event() {
                CloseHandle(overlapped.hEvent);
            }
        };
    }

    void openPort(Port &port, const LineOptions &options, bool) {
        //COM3 as \\.\COM3 (the names past COM9 need it); the port is always exclusive on Windows
        std::string path = port.path;
        if (path.rfind("\\\\.\\", 0) != 0) path = "\\\\.\\" + path;
        const HANDLE handle = CreateFileW(wide(path).c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
        if (handle == INVALID_HANDLE_VALUE) fail("CreateFile");
        port.handle = handle;
        try {
            configurePort(port, options);
            //A read returns at once with what came, or after a slice with nothing; writes are not limited in time
            COMMTIMEOUTS timeouts = {MAXDWORD, MAXDWORD, SLICE, 0, 0};
            if (!SetCommTimeouts(handle, &timeouts)) fail("SetCommTimeouts");
            PurgeComm(handle, PURGE_RXCLEAR | PURGE_TXCLEAR);
        } catch (...) {
            CloseHandle(handle);
            port.handle = INVALID_HANDLE_VALUE;
            throw;
        }
    }

    void configurePort(Port &port, const LineOptions &options) {
        DCB settings = {};
        settings.DCBlength = sizeof(settings);
        if (!GetCommState(port.handle, &settings)) fail("GetCommState");
        settings.BaudRate = options.baudRate;
        settings.ByteSize = static_cast<BYTE>(options.dataBits);
        settings.StopBits = options.stopBits == 2 ? TWOSTOPBITS : options.stopBits == 15 ? ONE5STOPBITS : ONESTOPBIT;
        switch (options.parity) {
            case 'e':
                settings.Parity = EVENPARITY;
                break;
            case 'o':
                settings.Parity = ODDPARITY;
                break;
            case 'm':
                settings.Parity = MARKPARITY;
                break;
            case 's':
                settings.Parity = SPACEPARITY;
                break;
            default:
                settings.Parity = NOPARITY;
        }
        settings.fParity = options.parity != 'n';
        settings.fBinary = TRUE;
        settings.fNull = FALSE;
        settings.fAbortOnError = FALSE;
        settings.fErrorChar = FALSE;
        settings.fDsrSensitivity = FALSE;
        settings.fOutxDsrFlow = FALSE;
        settings.fDtrControl = DTR_CONTROL_ENABLE;
        settings.fOutxCtsFlow = options.flowControl == 1;
        settings.fRtsControl = options.flowControl == 1 ? RTS_CONTROL_HANDSHAKE : RTS_CONTROL_ENABLE;
        settings.fOutX = options.flowControl == 2;
        settings.fInX = options.flowControl == 2;
        settings.fTXContinueOnXoff = TRUE;
        settings.XonChar = 0x11;
        settings.XoffChar = 0x13;
        settings.XonLim = 2048;
        settings.XoffLim = 512;
        if (!SetCommState(port.handle, &settings)) fail("SetCommState");
    }

    size_t writeSlice(Port &port, const uint8_t *data, size_t length) {
        if (port.closing) return 0;
        Event event;
        DWORD transferred = 0;
        const DWORD size = static_cast<DWORD>(length > 65536 ? 65536 : length);
        if (!WriteFile(port.handle, data, size, nullptr, &event.overlapped) && GetLastError() != ERROR_IO_PENDING) fail("WriteFile");
        waited(port, event.overlapped, transferred, "WriteFile");
        return transferred;
    }

    size_t readSlice(Port &port, uint8_t *data, size_t length) {
        if (port.closing) return 0;
        Event event;
        DWORD transferred = 0;
        const DWORD size = static_cast<DWORD>(length > 65536 ? 65536 : length);
        if (!ReadFile(port.handle, data, size, nullptr, &event.overlapped) && GetLastError() != ERROR_IO_PENDING) fail("ReadFile");
        //The time limits of the port end the read after a slice, with what came or nothing
        waited(port, event.overlapped, transferred, "ReadFile");
        return transferred;
    }

    void drainPort(Port &port) {
        //The output queue of the driver watched until empty (FlushFileBuffers cannot be stopped by a closing)
        while (!port.closing) {
            DWORD errors = 0;
            COMSTAT status = {};
            if (!ClearCommError(port.handle, &errors, &status)) fail("ClearCommError");
            if (status.cbOutQue == 0) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
    }

    void flushPort(Port &port, bool input, bool output) {
        DWORD flags = 0;
        if (input) flags |= PURGE_RXCLEAR;
        if (output) flags |= PURGE_TXCLEAR;
        if (flags && !PurgeComm(port.handle, flags)) fail("PurgeComm");
    }

    void closePort(Port &port, bool discard) {
        if (port.handle == INVALID_HANDLE_VALUE) return;
        if (discard) PurgeComm(port.handle, PURGE_TXABORT | PURGE_RXABORT | PURGE_TXCLEAR | PURGE_RXCLEAR);
        CancelIoEx(port.handle, nullptr);
        CloseHandle(port.handle);
        port.handle = INVALID_HANDLE_VALUE;
    }

    void signalsOf(Port &port, bool &cts, bool &dsr, bool &dcd, bool &ri) {
        DWORD lines = 0;
        if (!GetCommModemStatus(port.handle, &lines)) fail("GetCommModemStatus");
        cts = (lines & MS_CTS_ON) != 0;
        dsr = (lines & MS_DSR_ON) != 0;
        dcd = (lines & MS_RLSD_ON) != 0;
        ri = (lines & MS_RING_ON) != 0;
    }

    void setSignals(Port &port, int dtr, int rts, int brk) {
        if (dtr >= 0 && !EscapeCommFunction(port.handle, dtr ? SETDTR : CLRDTR)) fail("EscapeCommFunction");
        if (rts >= 0 && !EscapeCommFunction(port.handle, rts ? SETRTS : CLRRTS)) fail("EscapeCommFunction");
        if (brk >= 0 && !EscapeCommFunction(port.handle, brk ? SETBREAK : CLRBREAK)) fail("EscapeCommFunction");
    }

    namespace {
        std::string propertyOf(HDEVINFO set, SP_DEVINFO_DATA &device, DWORD property) {
            wchar_t buffer[1024] = {};
            DWORD type = 0;
            if (!SetupDiGetDeviceRegistryPropertyW(set, &device, property, &type, reinterpret_cast<PBYTE>(buffer), sizeof(buffer) - sizeof(wchar_t), nullptr)) return "";
            //A list (REG_MULTI_SZ): its first string
            return narrow(buffer);
        }

        int hexAfter(const std::string &text, const char *marker) {
            const size_t at = text.find(marker);
            if (at == std::string::npos) return -1;
            try {
                return std::stoi(text.substr(at + std::strlen(marker), 4), nullptr, 16);
            } catch (...) {
                return -1;
            }
        }
    }

    bool listPorts(std::vector<PortInfo> &ports) {
        const HDEVINFO set = SetupDiGetClassDevsW(&GUID_DEVCLASS_PORTS, nullptr, nullptr, DIGCF_PRESENT);
        if (set == INVALID_HANDLE_VALUE) return true;
        SP_DEVINFO_DATA device = {};
        device.cbSize = sizeof(device);
        for (DWORD index = 0; SetupDiEnumDeviceInfo(set, index, &device); index++) {
            const HKEY key = SetupDiOpenDevRegKey(set, &device, DICS_FLAG_GLOBAL, 0, DIREG_DEV, KEY_READ);
            if (key == INVALID_HANDLE_VALUE) continue;
            wchar_t name[256] = {};
            DWORD size = sizeof(name) - sizeof(wchar_t);
            DWORD type = 0;
            const LSTATUS status = RegQueryValueExW(key, L"PortName", nullptr, &type, reinterpret_cast<LPBYTE>(name), &size);
            RegCloseKey(key);
            if (status != ERROR_SUCCESS || type != REG_SZ) continue;
            const std::string path = narrow(name);
            //The serial ports (COMn), not the parallel ones (LPTn)
            if (path.rfind("COM", 0) != 0) continue;
            PortInfo info;
            info.path = path;
            info.product = propertyOf(set, device, SPDRP_FRIENDLYNAME);
            info.manufacturer = propertyOf(set, device, SPDRP_MFG);
            wchar_t instance[512] = {};
            if (SetupDiGetDeviceInstanceIdW(set, &device, instance, 511, nullptr)) {
                //USB\VID_0403&PID_6001\A50285BI: its ids, and its serial number when the last part is not made up by
                //Windows (an & in it)
                const std::string id = narrow(instance);
                info.vendorId = hexAfter(id, "VID_");
                info.productId = hexAfter(id, "PID_");
                const size_t last = id.rfind('\\');
                if (info.vendorId >= 0 && last != std::string::npos && id.find('&', last) == std::string::npos) info.serialNumber = id.substr(last + 1);
            }
            ports.push_back(info);
        }
        SetupDiDestroyDeviceInfoList(set);
        return true;
    }

    std::string nameOf(long code) {
        switch (static_cast<DWORD>(code)) {
            case ERROR_FILE_NOT_FOUND:
            case ERROR_PATH_NOT_FOUND:
            case ERROR_INVALID_NAME:
            case ERROR_BAD_PATHNAME:
                return "ENOENT";
            case ERROR_ACCESS_DENIED:
            case ERROR_SHARING_VIOLATION:
                return "EBUSY";
            case ERROR_INVALID_PARAMETER:
                return "EINVAL";
            case ERROR_INVALID_HANDLE:
                return "EBADF";
            case ERROR_OPERATION_ABORTED:
                return "ECANCELED";
            case ERROR_GEN_FAILURE:
            case ERROR_DEVICE_NOT_CONNECTED:
            case ERROR_BAD_COMMAND:
            case ERROR_NOT_READY:
                return "EIO";
            case ERROR_SEM_TIMEOUT:
                return "ETIMEDOUT";
            case ERROR_NOT_ENOUGH_MEMORY:
            case ERROR_OUTOFMEMORY:
                return "ENOMEM";
            default:
                return "EUNKNOWN";
        }
    }

    std::string messageOf(long code) {
        wchar_t *buffer = nullptr;
        const DWORD size = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, static_cast<DWORD>(code), MAKELANGID(LANG_ENGLISH, SUBLANG_ENGLISH_US), reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
        if (!size || !buffer) return "error " + std::to_string(code);
        std::string message = narrow(buffer);
        LocalFree(buffer);
        while (!message.empty() && (message.back() == '\n' || message.back() == '\r' || message.back() == ' ' || message.back() == '.')) message.pop_back();
        return message;
    }
}

#endif
