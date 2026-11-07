#ifdef _WIN32

#include "Port.h"
#include "Session.h"

#include <cstring>
#include <memory>
#include <string>
#include <initguid.h>
#include <setupapi.h>
#include <devguid.h>
#include <devpkey.h>
#include <ntddser.h>
#include <cfgmgr32.h>

namespace serial {

    namespace {
        //The bytes a drain cannot see once the queue of the driver is empty (the FIFO of the chip)
        constexpr size_t ALLOWANCE = 1024;
        //A read returns at once with what came, or after this long with nothing (then the port is checked)
        constexpr DWORD READ_SLICE = 1000;
        //How long a cancelled operation may take to end before the port is closed anyway
        constexpr DWORD CANCEL_WAIT = 2000;
        //The operations aborted by the driver in a row (its errors cleared each time) before the port is given up
        constexpr int ABORTS = 3;

        [[noreturn]] void fail(const char *syscall, DWORD code = GetLastError()) {
            throw Failure{static_cast<long>(code), syscall, "", "", false};
        }

        std::wstring wide(const std::string &text) {
            if (text.empty()) return L"";
            const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
            std::wstring result(static_cast<size_t>(size), L'\0');
            MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), &result[0], size);
            return result;
        }

        std::string narrow(const wchar_t *text) {
            if (!text || !*text) return "";
            const int size = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
            std::string result(static_cast<size_t>(size), '\0');
            WideCharToMultiByte(CP_UTF8, 0, text, -1, &result[0], size, nullptr, nullptr);
            result.resize(static_cast<size_t>(size > 0 ? size - 1 : 0));
            return result;
        }

        /**
         * A failure of a read or a write: the device gone for the errors drivers give once it is unplugged
         */
        Failure ioFailure(const char *syscall, DWORD code) {
            switch (code) {
                case ERROR_ACCESS_DENIED:
                case ERROR_BAD_COMMAND:
                case ERROR_GEN_FAILURE:
                case ERROR_NO_SUCH_DEVICE:
                case ERROR_DEVICE_NOT_CONNECTED:
                case ERROR_DEVICE_REMOVED:
                case ERROR_OPERATION_ABORTED:
                case ERROR_INVALID_HANDLE:
                    return Failure{static_cast<long>(code), syscall, "The device is gone (" + messageOf(static_cast<long>(code)) + ")", "EIO", true};
                default:
                    return Failure{static_cast<long>(code), syscall, "", "", false};
            }
        }

        /**
         * The errors of ClearCommError that mean the device is gone; the others (INVALID_FUNCTION, NOT_SUPPORTED…)
         * come from drivers that do not offer it (redirected ports of Remote Desktop, some virtual ones)
         */
        bool gone(DWORD code) {
            switch (code) {
                case ERROR_ACCESS_DENIED:
                case ERROR_BAD_COMMAND:
                case ERROR_GEN_FAILURE:
                case ERROR_NO_SUCH_DEVICE:
                case ERROR_DEVICE_NOT_CONNECTED:
                case ERROR_DEVICE_REMOVED:
                case ERROR_INVALID_HANDLE:
                    return true;
                default:
                    return false;
            }
        }

        /**
         * An overlapped operation and its buffer, on the heap: an operation a driver never ends is left to it rather
         * than freed under it
         */
        struct Io {
            OVERLAPPED overlapped = {};
            std::vector<uint8_t> buffer;
            bool pending = false;

            explicit Io(size_t size) : buffer(size) {
                overlapped.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
            }

            ~Io() {
                if (overlapped.hEvent) CloseHandle(overlapped.hEvent);
            }
        };

        /**
         * The device of a port on Windows: a communications port opened for overlapped operations, exclusive
         */
        class WindowsDevice : public Device {
        public:
            explicit WindowsDevice(Port &port) : port(port), options(port.options) {}

            void open() {
                //COM3 as \\.\COM3 (the names past COM9 need it)
                std::string path = port.path;
                if (path.rfind("\\\\.\\", 0) != 0) path = "\\\\.\\" + path;
                const HANDLE handle = CreateFileW(wide(path).c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
                if (handle == INVALID_HANDLE_VALUE) fail("CreateFile");
                port.handle = handle;
                try {
                    if (GetCommTimeouts(handle, &port.savedTimeouts)) port.timeoutsSaved = true;
                    configure(options);
                    COMMTIMEOUTS timeouts = {MAXDWORD, MAXDWORD, READ_SLICE, 0, 0};
                    if (!SetCommTimeouts(handle, &timeouts)) fail("SetCommTimeouts");
                    //The errors a previous program left latched, and what it left in the queues (some adapters hand
                    //over what they held a few milliseconds after the opening)
                    probe();
                    Sleep(10);
                    PurgeComm(handle, PURGE_RXCLEAR | PURGE_TXCLEAR);
                } catch (...) {
                    CloseHandle(handle);
                    port.handle = INVALID_HANDLE_VALUE;
                    throw;
                }
            }

            void close(bool discard) {
                if (port.handle == INVALID_HANDLE_VALUE) return;
                if (discard) PurgeComm(port.handle, PURGE_TXABORT | PURGE_RXABORT | PURGE_TXCLEAR | PURGE_RXCLEAR);
                if (port.timeoutsSaved) SetCommTimeouts(port.handle, &port.savedTimeouts);
                CloseHandle(port.handle);
                port.handle = INVALID_HANDLE_VALUE;
            }

            void configure(const LineOptions &next) override {
                DCB settings = {};
                settings.DCBlength = sizeof(settings);
                if (!GetCommState(port.handle, &settings)) fail("GetCommState");
                settings.BaudRate = next.baudRate;
                settings.ByteSize = static_cast<BYTE>(next.dataBits);
                settings.StopBits = next.stopBits == 2 ? TWOSTOPBITS : next.stopBits == 15 ? ONE5STOPBITS : ONESTOPBIT;
                switch (next.parity) {
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
                settings.fParity = next.parity != 'n';
                settings.fBinary = TRUE;
                settings.fNull = FALSE;
                settings.fAbortOnError = FALSE;
                settings.fErrorChar = FALSE;
                settings.fDsrSensitivity = FALSE;
                //The levels of the lines as the port holds them (set by setSignals), not raised again by a configuration
                settings.fOutxDsrFlow = next.flowControl == 3;
                settings.fDtrControl = next.flowControl == 3 ? DTR_CONTROL_HANDSHAKE : port.dtr ? DTR_CONTROL_ENABLE : DTR_CONTROL_DISABLE;
                settings.fOutxCtsFlow = next.flowControl == 1;
                settings.fRtsControl = next.flowControl == 1 ? RTS_CONTROL_HANDSHAKE : port.rts ? RTS_CONTROL_ENABLE : RTS_CONTROL_DISABLE;
                settings.fOutX = next.flowControl == 2;
                settings.fInX = next.flowControl == 2;
                settings.fTXContinueOnXoff = TRUE;
                settings.XonChar = 0x11;
                settings.XoffChar = 0x13;
                //The limits of the driver kept (some refuse ones past their buffer), defaults when it gives none
                if (!settings.XonLim) settings.XonLim = 2048;
                if (!settings.XoffLim) settings.XoffLim = 512;
                if (!SetCommState(port.handle, &settings)) fail("SetCommState");
                options = next;
            }

            void flush(bool input, bool output) override {
                DWORD flags = 0;
                if (input) flags |= PURGE_RXCLEAR;
                if (output) flags |= PURGE_TXCLEAR;
                if (flags && !PurgeComm(port.handle, flags)) fail("PurgeComm");
            }

            void signals(Event &event) override {
                DWORD lines = 0;
                if (!GetCommModemStatus(port.handle, &lines)) fail("GetCommModemStatus");
                event.cts = (lines & MS_CTS_ON) != 0;
                event.dsr = (lines & MS_DSR_ON) != 0;
                event.dcd = (lines & MS_RLSD_ON) != 0;
                event.ri = (lines & MS_RING_ON) != 0;
            }

            void setSignals(int dtr, int rts, int brk) override {
                if (rts >= 0 && options.flowControl == 1) throw Failure{ERROR_INVALID_PARAMETER, "EscapeCommFunction", "RTS is driven by the RTS/CTS flow control", "EINVAL", false};
                if (dtr >= 0 && options.flowControl == 3) throw Failure{ERROR_INVALID_PARAMETER, "EscapeCommFunction", "DTR is driven by the DTR/DSR flow control", "EINVAL", false};
                if (dtr >= 0) {
                    if (!EscapeCommFunction(port.handle, dtr ? SETDTR : CLRDTR)) fail("EscapeCommFunction");
                    port.dtr = dtr != 0;
                }
                if (rts >= 0) {
                    if (!EscapeCommFunction(port.handle, rts ? SETRTS : CLRRTS)) fail("EscapeCommFunction");
                    port.rts = rts != 0;
                }
                if (brk >= 0 && !EscapeCommFunction(port.handle, brk ? SETBREAK : CLRBREAK)) fail("EscapeCommFunction");
            }

            long queued() override {
                DWORD errors = 0;
                COMSTAT status = {};
                if (!commErrors) return 0;
                if (!ClearCommError(port.handle, &errors, &status)) {
                    const DWORD error = GetLastError();
                    if (gone(error)) throw ioFailure("ClearCommError", error);
                    //Not offered: the drains rely on the time the bytes take alone
                    commErrors = false;
                    return 0;
                }
                return static_cast<long>(status.cbOutQue);
            }

            /**
             * The latched errors cleared (whether the port is still there): false when the device is gone
             */
            bool probe() {
                if (!commErrors) return true;
                DWORD errors = 0;
                COMSTAT status = {};
                if (ClearCommError(port.handle, &errors, &status)) return true;
                lastError = GetLastError();
                if (gone(lastError)) return false;
                commErrors = false;
                return true;
            }

            DWORD lastError = 0;

        private:
            bool commErrors = true;
            Port &port;
            LineOptions options;
        };

        /**
         * Wait for a cancelled operation to end, for a while: one that does not is left to the driver
         */
        void settle(Port &port, std::unique_ptr<Io> &io) {
            if (!io || !io->pending) return;
            DWORD count = 0;
            if (WaitForSingleObject(io->overlapped.hEvent, CANCEL_WAIT) == WAIT_OBJECT_0) {
                GetOverlappedResult(port.handle, &io->overlapped, &count, FALSE);
                io->pending = false;
            } else {
                (void) io.release();
            }
        }
    }

    Port::Port() {
        wakeEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    }

    Port::~Port() {
        if (thread.joinable()) {
            if (thread.get_id() == std::this_thread::get_id()) thread.detach();
            else thread.join();
        }
        if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
        if (wakeEvent) CloseHandle(wakeEvent);
    }

    void Port::push(Command command) {
        {
            std::lock_guard<std::mutex> lock(mutex);
            commands.push_back(std::move(command));
        }
        wake();
    }

    void Port::wake() {
        if (wakeEvent) SetEvent(wakeEvent);
    }

    void run(Port &port) {
        WindowsDevice device(port);
        try {
            device.open();
        } catch (const Failure &failure) {
            auto *failed = new Event();
            failed->kind = EventKind::Failed;
            failed->id = 0;
            failed->failure = failure;
            port.post(failed);
            auto *closed = new Event();
            closed->kind = EventKind::Closed;
            port.post(closed);
            port.finished = true;
            return;
        }
        auto *opened = new Event();
        opened->kind = EventKind::Opened;
        port.post(opened);
        Session session(port, device, ALLOWANCE);
        auto reader = std::make_unique<Io>(65536);
        auto writer = std::make_unique<Io>(65536);
        DWORD writing = 0;
        int aborts = 0;
        //An operation the driver aborted without our asking: its errors cleared, retried a few times, else the port is gone
        const auto aborted = [&](const char *syscall) -> void {
            if (!device.probe()) session.fatal(ioFailure(syscall, device.lastError));
            else if (++aborts > ABORTS) session.fatal(ioFailure(syscall, ERROR_OPERATION_ABORTED));
        };
        for (;;) {
            session.process();
            if (session.finished()) break;
            if (!session.dead()) {
                if (session.reading() && !reader->pending) {
                    if (ReadFile(port.handle, reader->buffer.data(), static_cast<DWORD>(reader->buffer.size()), nullptr, &reader->overlapped) || GetLastError() == ERROR_IO_PENDING) {
                        reader->pending = true;
                    } else {
                        const DWORD error = GetLastError();
                        if (error == ERROR_OPERATION_ABORTED) aborted("ReadFile");
                        else session.fatal(ioFailure("ReadFile", error));
                    }
                }
                size_t length = 0;
                const uint8_t *pending = session.pending(length);
                if (pending && !writer->pending && !session.dead()) {
                    //A copy: the write of the session may be cancelled (a closing) while the driver still holds it
                    writing = static_cast<DWORD>(length > writer->buffer.size() ? writer->buffer.size() : length);
                    std::memcpy(writer->buffer.data(), pending, writing);
                    if (WriteFile(port.handle, writer->buffer.data(), writing, nullptr, &writer->overlapped) || GetLastError() == ERROR_IO_PENDING) {
                        writer->pending = true;
                    } else {
                        const DWORD error = GetLastError();
                        if (error == ERROR_OPERATION_ABORTED) aborted("WriteFile");
                        else session.fatal(ioFailure("WriteFile", error));
                    }
                }
            }
            HANDLE handles[3] = {port.wakeEvent, nullptr, nullptr};
            DWORD count = 1;
            if (reader->pending) handles[count++] = reader->overlapped.hEvent;
            if (writer->pending) handles[count++] = writer->overlapped.hEvent;
            int timeout = session.timeout();
            const bool idle = timeout < 0 && !reader->pending && !writer->pending;
            const DWORD result = WaitForMultipleObjects(count, handles, FALSE, timeout < 0 ? (idle ? READ_SLICE : INFINITE) : static_cast<DWORD>(timeout));
            if (result == WAIT_FAILED) {
                const DWORD error = GetLastError();
                CancelIoEx(port.handle, nullptr);
                settle(port, reader);
                settle(port, writer);
                if (!reader) reader = std::make_unique<Io>(65536);
                if (!writer) writer = std::make_unique<Io>(65536);
                session.fatal(ioFailure("WaitForMultipleObjects", error));
                continue;
            }
            if (reader->pending) {
                DWORD transferred = 0;
                if (GetOverlappedResult(port.handle, &reader->overlapped, &transferred, FALSE)) {
                    reader->pending = false;
                    aborts = 0;
                    if (transferred > 0) session.received(reader->buffer.data(), transferred);
                    //A read that waited its time for nothing: whether the port is still there
                    else if (!device.probe()) session.fatal(ioFailure("ClearCommError", device.lastError));
                } else if (GetLastError() != ERROR_IO_INCOMPLETE) {
                    const DWORD error = GetLastError();
                    reader->pending = false;
                    if (error == ERROR_OPERATION_ABORTED) aborted("ReadFile");
                    else session.fatal(ioFailure("ReadFile", error));
                }
            }
            if (writer->pending) {
                DWORD transferred = 0;
                if (GetOverlappedResult(port.handle, &writer->overlapped, &transferred, FALSE)) {
                    writer->pending = false;
                    aborts = 0;
                    session.wrote(transferred);
                } else if (GetLastError() != ERROR_IO_INCOMPLETE) {
                    const DWORD error = GetLastError();
                    writer->pending = false;
                    //What went out before the abort counts, the rest is sent again
                    session.wrote(transferred);
                    if (error == ERROR_OPERATION_ABORTED) aborted("WriteFile");
                    else session.fatal(ioFailure("WriteFile", error));
                }
            }
            //Nothing to do for a while: whether the port is still there (some drivers keep a removed port answering)
            if (result == WAIT_TIMEOUT && idle && !session.dead() && !device.probe()) session.fatal(ioFailure("ClearCommError", device.lastError));
            session.tick();
        }
        if (reader->pending || writer->pending) {
            CancelIoEx(port.handle, nullptr);
            settle(port, reader);
            settle(port, writer);
        }
        device.close(session.discard());
        session.closed();
        port.finished = true;
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

        std::string instanceOf(DEVINST instance) {
            wchar_t id[MAX_DEVICE_ID_LEN + 1] = {};
            if (CM_Get_Device_IDW(instance, id, MAX_DEVICE_ID_LEN, 0) != CR_SUCCESS) return "";
            return narrow(id);
        }

        /**
         * The serial number in an instance id: USB\VID_0403&PID_6001\A50285BI (its last part, unless Windows made it
         * up: an & in it), FTDIBUS\VID_0403+PID_6001+A50285BIA\0000 (the FTDI driver: its third field less the letter
         * of the channel)
         */
        std::string serialOf(const std::string &id) {
            if (id.rfind("FTDIBUS\\", 0) == 0) {
                const size_t first = id.find('+');
                const size_t second = first == std::string::npos ? first : id.find('+', first + 1);
                const size_t end = second == std::string::npos ? second : id.find('\\', second + 1);
                if (end == std::string::npos) return "";
                std::string serial = id.substr(second + 1, end - second - 1);
                if (serial.size() > 1 && serial.back() >= 'A' && serial.back() <= 'D') serial.pop_back();
                return serial;
            }
            const size_t last = id.rfind('\\');
            if (last == std::string::npos || id.find('&', last) != std::string::npos) return "";
            return id.substr(last + 1);
        }

        /**
         * The COM name of a device: PortName (the Ports class), AttachedTo (a modem)
         */
        std::string comNameOf(HDEVINFO set, SP_DEVINFO_DATA &device) {
            const HKEY key = SetupDiOpenDevRegKey(set, &device, DICS_FLAG_GLOBAL, 0, DIREG_DEV, KEY_READ);
            if (key == INVALID_HANDLE_VALUE) return "";
            std::string name;
            for (const wchar_t *value: {L"PortName", L"AttachedTo"}) {
                wchar_t data[256] = {};
                DWORD size = sizeof(data) - sizeof(wchar_t);
                DWORD type = 0;
                if (RegQueryValueExW(key, value, nullptr, &type, reinterpret_cast<LPBYTE>(data), &size) == ERROR_SUCCESS && type == REG_SZ) {
                    name = narrow(data);
                    if (name.rfind("COM", 0) == 0) break;
                    name.clear();
                }
            }
            RegCloseKey(key);
            return name;
        }

        /**
         * The name of the product as its bus reports it (the USB string), else the friendly name less its " (COMn)"
         */
        std::string productOf(HDEVINFO set, SP_DEVINFO_DATA &device) {
            wchar_t buffer[512] = {};
            DEVPROPTYPE type = 0;
            if (SetupDiGetDevicePropertyW(set, &device, &DEVPKEY_Device_BusReportedDeviceDesc, &type, reinterpret_cast<PBYTE>(buffer), sizeof(buffer) - sizeof(wchar_t), nullptr, 0) && type == DEVPROP_TYPE_STRING && buffer[0])
                return narrow(buffer);
            std::string name = propertyOf(set, device, SPDRP_FRIENDLYNAME);
            const size_t suffix = name.rfind(" (COM");
            if (suffix != std::string::npos && name.back() == ')') name.resize(suffix);
            return name;
        }

        void listClass(const GUID &guid, DWORD flags, std::vector<PortInfo> &ports) {
            const HDEVINFO set = SetupDiGetClassDevsW(&guid, nullptr, nullptr, DIGCF_PRESENT | flags);
            if (set == INVALID_HANDLE_VALUE) return;
            SP_DEVINFO_DATA device = {};
            device.cbSize = sizeof(device);
            for (DWORD index = 0; SetupDiEnumDeviceInfo(set, index, &device); index++) {
                const std::string path = comNameOf(set, device);
                //The serial ports (COMn), not the parallel ones (LPTn)
                if (path.empty()) continue;
                //A disabled device is listed as present
                ULONG status = 0;
                ULONG problem = 0;
                if (CM_Get_DevNode_Status(&status, &problem, device.DevInst, 0) == CR_SUCCESS && problem == CM_PROB_DISABLED) continue;
                bool known = false;
                for (const PortInfo &port: ports) known = known || port.path == path;
                if (known) continue;
                PortInfo info;
                info.path = path;
                info.product = productOf(set, device);
                //FTDI5.inf,%ftdi%;FTDI: the part after the last ;
                info.manufacturer = propertyOf(set, device, SPDRP_MFG);
                const size_t semicolon = info.manufacturer.rfind(';');
                if (semicolon != std::string::npos) info.manufacturer = info.manufacturer.substr(semicolon + 1);
                const std::string id = instanceOf(device.DevInst);
                info.vendorId = hexAfter(id, "VID_");
                info.productId = hexAfter(id, "PID_");
                if (info.vendorId >= 0) {
                    info.serialNumber = serialOf(id);
                    //An interface of a composite device (&MI_xx): the serial number is the one of its parent
                    DEVINST parent = 0;
                    if (info.serialNumber.empty() && id.find("&MI_") != std::string::npos && CM_Get_Parent(&parent, device.DevInst, 0) == CR_SUCCESS)
                        info.serialNumber = serialOf(instanceOf(parent));
                }
                ports.push_back(info);
            }
            SetupDiDestroyDeviceInfoList(set);
        }
    }

    bool listPorts(std::vector<PortInfo> &ports) {
        //The interface of the COM ports (most drivers of Windows 10 and later), then the classes of the ports, the
        //modems and the multiport cards
        listClass(GUID_DEVINTERFACE_COMPORT, DIGCF_DEVICEINTERFACE, ports);
        listClass(GUID_DEVCLASS_PORTS, 0, ports);
        listClass(GUID_DEVCLASS_MODEM, 0, ports);
        listClass(GUID_DEVCLASS_MULTIPORTSERIAL, 0, ports);
        //The ports of drivers outside those classes, as the system maps them (their path only)
        HKEY key = nullptr;
        if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"HARDWARE\\DEVICEMAP\\SERIALCOMM", 0, KEY_READ, &key) == ERROR_SUCCESS) {
            for (DWORD index = 0;; index++) {
                wchar_t name[256] = {};
                wchar_t data[256] = {};
                DWORD nameSize = 255;
                DWORD dataSize = sizeof(data) - sizeof(wchar_t);
                DWORD type = 0;
                if (RegEnumValueW(key, index, name, &nameSize, nullptr, &type, reinterpret_cast<LPBYTE>(data), &dataSize) != ERROR_SUCCESS) break;
                if (type != REG_SZ) continue;
                const std::string path = narrow(data);
                bool known = false;
                for (const PortInfo &port: ports) known = known || port.path == path;
                if (!known && !path.empty()) {
                    PortInfo info;
                    info.path = path;
                    ports.push_back(info);
                }
            }
            RegCloseKey(key);
        }
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
            case ERROR_NO_SUCH_DEVICE:
            case ERROR_DEVICE_REMOVED:
                return "EIO";
            case ERROR_SEM_TIMEOUT:
                return "ETIMEDOUT";
            case ERROR_NOT_SUPPORTED:
                return "ENOTSUP";
            case ERROR_NOT_ENOUGH_MEMORY:
            case ERROR_OUTOFMEMORY:
                return "ENOMEM";
            default:
                return "EUNKNOWN";
        }
    }

    std::string messageOf(long code) {
        wchar_t *buffer = nullptr;
        const DWORD flags = FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS;
        DWORD size = FormatMessageW(flags, nullptr, static_cast<DWORD>(code), MAKELANGID(LANG_ENGLISH, SUBLANG_ENGLISH_US), reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
        //A system without its English messages: the ones of its language
        if (!size || !buffer) size = FormatMessageW(flags, nullptr, static_cast<DWORD>(code), 0, reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
        if (!size || !buffer) return "error " + std::to_string(code);
        std::string message = narrow(buffer);
        LocalFree(buffer);
        while (!message.empty() && (message.back() == '\n' || message.back() == '\r' || message.back() == ' ' || message.back() == '.')) message.pop_back();
        return message;
    }
}

#endif
