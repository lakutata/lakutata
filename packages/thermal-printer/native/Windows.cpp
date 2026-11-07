#ifdef _WIN32

#include "Printer.h"

#include <algorithm>
#include <cstring>
#include <memory>
#include <string>
#include <windows.h>
#include <winioctl.h>
#include <initguid.h>
#include <setupapi.h>
#include <devpkey.h>
#include <cfgmgr32.h>
#include <winspool.h>

namespace printer {

    namespace {
        //The interface of the USB printers (usbprint.sys), and its request for the IEEE 1284 id (usbprint.h)
        DEFINE_GUID(USBPRINT_INTERFACE, 0x28d78fad, 0x5a12, 0x11d1, 0xae, 0x5b, 0x00, 0x00, 0xf8, 0x03, 0xa8, 0xc2);
        constexpr DWORD IOCTL_USBPRINT_GET_1284_ID = CTL_CODE(FILE_DEVICE_UNKNOWN, 13, METHOD_BUFFERED, FILE_ANY_ACCESS);

        [[noreturn]] void fail(const char *syscall, DWORD code = GetLastError(), const char *name = "") {
            throw Failure{static_cast<long>(code), syscall, "", name};
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

        std::string instanceOf(DEVINST instance) {
            wchar_t id[MAX_DEVICE_ID_LEN + 1] = {};
            if (CM_Get_Device_IDW(instance, id, MAX_DEVICE_ID_LEN, 0) != CR_SUCCESS) return "";
            return narrow(id);
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

        std::string devicePropertyOf(DEVINST instance, const DEVPROPKEY &key) {
            wchar_t buffer[512] = {};
            DEVPROPTYPE type = 0;
            ULONG size = sizeof(buffer) - sizeof(wchar_t);
            if (CM_Get_DevNode_PropertyW(instance, &key, &type, reinterpret_cast<PBYTE>(buffer), &size, 0) != CR_SUCCESS || type != DEVPROP_TYPE_STRING) return "";
            return narrow(buffer);
        }

        /**
         * The IEEE 1284 id of a printer: its length first, in two bytes (big-endian), counting them
         */
        std::string deviceIdOf(const std::wstring &path) {
            const HANDLE handle = CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
            if (handle == INVALID_HANDLE_VALUE) return "";
            unsigned char buffer[1024] = {};
            DWORD returned = 0;
            std::string result;
            if (DeviceIoControl(handle, IOCTL_USBPRINT_GET_1284_ID, nullptr, 0, buffer, sizeof(buffer), &returned, nullptr) && returned > 2) {
                size_t length = (static_cast<size_t>(buffer[0]) << 8) | buffer[1];
                if (length > returned) length = returned;
                if (length > 2) result.assign(reinterpret_cast<const char *>(buffer + 2), length - 2);
            }
            CloseHandle(handle);
            return result;
        }
    }

    struct UsbDevice {
        HANDLE handle = INVALID_HANDLE_VALUE;
        std::atomic<bool> aborted{false};
    };

    void listUsb(std::vector<UsbInfo> &printers) {
        const HDEVINFO set = SetupDiGetClassDevsW(&USBPRINT_INTERFACE, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
        if (set == INVALID_HANDLE_VALUE) return;
        SP_DEVICE_INTERFACE_DATA interfaceData = {};
        interfaceData.cbSize = sizeof(interfaceData);
        for (DWORD index = 0; SetupDiEnumDeviceInterfaces(set, nullptr, &USBPRINT_INTERFACE, index, &interfaceData); index++) {
            DWORD size = 0;
            SetupDiGetDeviceInterfaceDetailW(set, &interfaceData, nullptr, 0, &size, nullptr);
            if (!size) continue;
            std::unique_ptr<BYTE[]> storage(new BYTE[size]);
            auto *detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W *>(storage.get());
            detail->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
            SP_DEVINFO_DATA device = {};
            device.cbSize = sizeof(device);
            if (!SetupDiGetDeviceInterfaceDetailW(set, &interfaceData, detail, size, nullptr, &device)) continue;
            UsbInfo info;
            info.path = narrow(detail->DevicePath);
            //The printer node (USBPRINT\…) sits under its USB device (USB\VID_04B8&PID_0202\SERIAL)
            DEVINST parent = 0;
            const std::string usb = CM_Get_Parent(&parent, device.DevInst, 0) == CR_SUCCESS ? instanceOf(parent) : "";
            info.vendorId = hexAfter(usb, "VID_");
            info.productId = hexAfter(usb, "PID_");
            const size_t last = usb.rfind('\\');
            if (last != std::string::npos && usb.find('&', last) == std::string::npos) info.serialNumber = usb.substr(last + 1);
            if (parent) info.product = devicePropertyOf(parent, DEVPKEY_Device_BusReportedDeviceDesc);
            if (info.product.empty()) info.product = devicePropertyOf(device.DevInst, DEVPKEY_Device_FriendlyName);
            if (info.product.empty()) info.product = devicePropertyOf(device.DevInst, DEVPKEY_Device_DeviceDesc);
            info.manufacturer = devicePropertyOf(device.DevInst, DEVPKEY_Device_Manufacturer);
            info.deviceId = deviceIdOf(detail->DevicePath);
            printers.push_back(info);
        }
        SetupDiDestroyDeviceInfoList(set);
    }

    UsbDevice *openUsb(const UsbTarget &target) {
        const HANDLE handle = CreateFileW(wide(target.path).c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
        if (handle == INVALID_HANDLE_VALUE) fail("CreateFile");
        auto *device = new UsbDevice();
        device->handle = handle;
        return device;
    }

    void writeUsb(UsbDevice *device, const uint8_t *data, size_t length, int64_t stallMs) {
        OVERLAPPED overlapped = {};
        overlapped.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (!overlapped.hEvent) fail("CreateEvent");
        std::unique_ptr<void, decltype(&CloseHandle)> event(overlapped.hEvent, &CloseHandle);
        size_t offset = 0;
        while (offset < length) {
            if (device->aborted) throw Failure{ERROR_OPERATION_ABORTED, "WriteFile", "The printer is closed", "ECANCELED"};
            const DWORD size = static_cast<DWORD>(std::min<size_t>(length - offset, 65536));
            DWORD transferred = 0;
            ResetEvent(overlapped.hEvent);
            if (!WriteFile(device->handle, data + offset, size, nullptr, &overlapped) && GetLastError() != ERROR_IO_PENDING) fail("WriteFile");
            const DWORD waited = WaitForSingleObject(overlapped.hEvent, stallMs > 0 ? static_cast<DWORD>(stallMs) : INFINITE);
            if (waited != WAIT_OBJECT_0) {
                //Nothing finished within the stall time: what moved counts, nothing at all fails the write
                CancelIoEx(device->handle, &overlapped);
                GetOverlappedResult(device->handle, &overlapped, &transferred, TRUE);
                if (device->aborted) throw Failure{ERROR_OPERATION_ABORTED, "WriteFile", "The printer is closed", "ECANCELED"};
                if (!transferred) throw Failure{WAIT_TIMEOUT, "WriteFile", "The printer took no data for " + std::to_string(stallMs) + " ms", "ETIMEDOUT"};
                offset += transferred;
                continue;
            }
            if (!GetOverlappedResult(device->handle, &overlapped, &transferred, FALSE)) {
                const DWORD error = GetLastError();
                if (error == ERROR_OPERATION_ABORTED && device->aborted) throw Failure{static_cast<long>(error), "WriteFile", "The printer is closed", "ECANCELED"};
                fail("WriteFile", error);
            }
            offset += transferred;
        }
    }

    void abortUsb(UsbDevice *device) {
        device->aborted = true;
        CancelIoEx(device->handle, nullptr);
    }

    void closeUsb(UsbDevice *device) {
        CancelIoEx(device->handle, nullptr);
        CloseHandle(device->handle);
        delete device;
    }

    void listQueues(std::vector<QueueInfo> &queues) {
        DWORD needed = 0;
        DWORD count = 0;
        const DWORD flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        EnumPrintersW(flags, nullptr, 2, nullptr, 0, &needed, &count);
        if (!needed) return;
        std::unique_ptr<BYTE[]> buffer(new BYTE[needed]);
        if (!EnumPrintersW(flags, nullptr, 2, buffer.get(), needed, &needed, &count)) fail("EnumPrinters");
        const auto *printers = reinterpret_cast<const PRINTER_INFO_2W *>(buffer.get());
        for (DWORD index = 0; index < count; index++) {
            QueueInfo info;
            info.name = narrow(printers[index].pPrinterName);
            info.driver = narrow(printers[index].pDriverName);
            info.port = narrow(printers[index].pPortName);
            info.isDefault = (printers[index].Attributes & PRINTER_ATTRIBUTE_DEFAULT) != 0;
            queues.push_back(info);
        }
    }

    void printRaw(const std::string &name, const uint8_t *data, size_t length, const std::string &document) {
        std::wstring printerName = wide(name);
        HANDLE printer = nullptr;
        if (!OpenPrinterW(&printerName[0], &printer, nullptr)) fail("OpenPrinter");
        std::wstring documentName = wide(document);
        //RAW for a driver of version 3; a driver of version 4 (XPS) renders RAW documents into nothing, its data type
        //that passes the bytes to the port as they are is XPS_PASS
        wchar_t raw[] = L"RAW";
        wchar_t passThrough[] = L"XPS_PASS";
        wchar_t *datatype = raw;
        DWORD needed = 0;
        GetPrinterDriverW(printer, nullptr, 8, nullptr, 0, &needed);
        if (needed) {
            std::unique_ptr<BYTE[]> driver(new BYTE[needed]);
            if (GetPrinterDriverW(printer, nullptr, 8, driver.get(), needed, &needed) && (reinterpret_cast<const DRIVER_INFO_8W *>(driver.get())->dwPrinterDriverAttributes & PRINTER_DRIVER_XPS)) datatype = passThrough;
        }
        DOC_INFO_1W info = {&documentName[0], nullptr, datatype};
        if (!StartDocPrinterW(printer, 1, reinterpret_cast<LPBYTE>(&info))) {
            const DWORD error = GetLastError();
            ClosePrinter(printer);
            fail("StartDocPrinter", error);
        }
        bool written = StartPagePrinter(printer) != FALSE;
        DWORD error = written ? 0 : GetLastError();
        size_t offset = 0;
        while (written && offset < length) {
            DWORD sent = 0;
            const DWORD size = static_cast<DWORD>(std::min<size_t>(length - offset, 65536));
            if (!WritePrinter(printer, const_cast<uint8_t *>(data + offset), size, &sent) || sent == 0) {
                error = GetLastError();
                written = false;
                break;
            }
            offset += sent;
        }
        if (written) EndPagePrinter(printer);
        //A job failed is deleted rather than printed half
        if (!written) AbortPrinter(printer);
        else EndDocPrinter(printer);
        ClosePrinter(printer);
        if (!written) fail("WritePrinter", error ? error : ERROR_WRITE_FAULT);
    }

    std::string nameOf(long code) {
        switch (static_cast<DWORD>(code)) {
            case ERROR_FILE_NOT_FOUND:
            case ERROR_PATH_NOT_FOUND:
            case ERROR_INVALID_PRINTER_NAME:
                return "ENOENT";
            case ERROR_ACCESS_DENIED:
            case ERROR_SHARING_VIOLATION:
                return "EBUSY";
            case ERROR_INVALID_PARAMETER:
                return "EINVAL";
            case ERROR_OPERATION_ABORTED:
                return "ECANCELED";
            case ERROR_GEN_FAILURE:
            case ERROR_DEVICE_NOT_CONNECTED:
            case ERROR_BAD_COMMAND:
            case ERROR_NOT_READY:
            case ERROR_NO_SUCH_DEVICE:
            case ERROR_DEVICE_REMOVED:
                return "EIO";
            case WAIT_TIMEOUT:
            case ERROR_SEM_TIMEOUT:
                return "ETIMEDOUT";
            default:
                return "EUNKNOWN";
        }
    }

    std::string messageOf(long code) {
        wchar_t *buffer = nullptr;
        const DWORD flags = FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS;
        DWORD size = FormatMessageW(flags, nullptr, static_cast<DWORD>(code), MAKELANGID(LANG_ENGLISH, SUBLANG_ENGLISH_US), reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
        if (!size || !buffer) size = FormatMessageW(flags, nullptr, static_cast<DWORD>(code), 0, reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
        if (!size || !buffer) return "error " + std::to_string(code);
        std::string message = narrow(buffer);
        LocalFree(buffer);
        while (!message.empty() && (message.back() == '\n' || message.back() == '\r' || message.back() == ' ' || message.back() == '.')) message.pop_back();
        return message;
    }
}

#endif
