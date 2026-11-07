#ifdef __APPLE__

#include "Printer.h"

#include <algorithm>
#include <cstring>
#include <mach/mach_error.h>
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/IOCFPlugIn.h>
#include <IOKit/usb/IOUSBLib.h>

namespace printer {

    namespace {
        //The class of the printers (USB Device Class Definition for Printing Devices)
        constexpr int PRINTER_CLASS = 7;
        //GET_DEVICE_ID: class, interface, device to host
        constexpr UInt8 GET_DEVICE_ID = 0;

        using Interface = IOUSBInterfaceInterface300;
        using Device = IOUSBDeviceInterface300;

        [[noreturn]] void fail(const char *syscall, IOReturn code, const char *name = "") {
            throw Failure{static_cast<long>(code), syscall, "", name};
        }

        std::string stringOf(CFTypeRef value) {
            if (!value || CFGetTypeID(value) != CFStringGetTypeID()) return "";
            const auto string = static_cast<CFStringRef>(value);
            const CFIndex size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(string), kCFStringEncodingUTF8) + 1;
            std::string result(static_cast<size_t>(size), '\0');
            if (!CFStringGetCString(string, &result[0], size, kCFStringEncodingUTF8)) return "";
            result.resize(std::strlen(result.c_str()));
            return result;
        }

        long long numberOf(CFTypeRef value) {
            long long result = -1;
            if (value && CFGetTypeID(value) == CFNumberGetTypeID()) CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberLongLongType, &result);
            return result;
        }

        CFTypeRef property(io_object_t entry, const char *key) {
            const CFStringRef name = CFStringCreateWithCString(kCFAllocatorDefault, key, kCFStringEncodingUTF8);
            const CFTypeRef value = IORegistryEntryCreateCFProperty(entry, name, kCFAllocatorDefault, 0);
            CFRelease(name);
            return value;
        }

        std::string propertyString(io_object_t entry, const char *key, const char *fallback = nullptr) {
            CFTypeRef value = property(entry, key);
            std::string result = stringOf(value);
            if (value) CFRelease(value);
            if (result.empty() && fallback) {
                value = property(entry, fallback);
                result = stringOf(value);
                if (value) CFRelease(value);
            }
            return result;
        }

        long long propertyNumber(io_object_t entry, const char *key) {
            const CFTypeRef value = property(entry, key);
            const long long result = numberOf(value);
            if (value) CFRelease(value);
            return result;
        }

        /**
         * A plug-in of a service: the user client of an interface or a device
         */
        template<typename T>
        T **plugin(io_object_t service, CFUUIDRef type, CFUUIDRef interfaceId) {
            IOCFPlugInInterface **plugin = nullptr;
            SInt32 score = 0;
            if (IOCreatePlugInInterfaceForService(service, type, kIOCFPlugInInterfaceID, &plugin, &score) != kIOReturnSuccess || !plugin) return nullptr;
            T **result = nullptr;
            (*plugin)->QueryInterface(plugin, CFUUIDGetUUIDBytes(interfaceId), reinterpret_cast<LPVOID *>(&result));
            IODestroyPlugInInterface(plugin);
            return result;
        }

        /**
         * The IEEE 1284 id of a printer, asked of its device (a request that needs neither to be open)
         */
        std::string deviceIdOf(io_object_t device, int interfaceNumber, int alternate) {
            Device **user = plugin<Device>(device, kIOUSBDeviceUserClientTypeID, kIOUSBDeviceInterfaceID300);
            if (!user) return "";
            uint8_t buffer[1024] = {};
            IOUSBDevRequestTO request = {};
            //Device to host, class, interface (USBmakebmRequestType mixes the enumerations of two headers)
            request.bmRequestType = 0xA1;
            request.bRequest = GET_DEVICE_ID;
            request.wValue = 0;
            request.wIndex = static_cast<UInt16>((interfaceNumber << 8) | alternate);
            request.wLength = sizeof(buffer);
            request.pData = buffer;
            request.noDataTimeout = 1000;
            request.completionTimeout = 2000;
            std::string result;
            if ((*user)->DeviceRequestTO(user, &request) == kIOReturnSuccess && request.wLenDone > 2) {
                //Its length first, in two bytes (big-endian), counting them
                size_t length = (static_cast<size_t>(buffer[0]) << 8) | buffer[1];
                if (length > request.wLenDone) length = request.wLenDone;
                if (length > 2) result.assign(reinterpret_cast<const char *>(buffer + 2), length - 2);
            }
            (*user)->Release(user);
            return result;
        }

        /**
         * The interfaces of the printer class: IOUSBHostInterface (macOS 11 and later), else IOUSBInterface
         */
        template<typename Visit>
        void eachPrinterInterface(Visit visit) {
            for (const char *className: {"IOUSBHostInterface", "IOUSBInterface"}) {
                io_iterator_t iterator = 0;
                if (IOServiceGetMatchingServices(MACH_PORT_NULL, IOServiceMatching(className), &iterator) != KERN_SUCCESS) continue;
                bool found = false;
                io_object_t service;
                while ((service = IOIteratorNext(iterator))) {
                    if (propertyNumber(service, "bInterfaceClass") == PRINTER_CLASS) {
                        found = true;
                        io_object_t device = 0;
                        if (IORegistryEntryGetParentEntry(service, kIOServicePlane, &device) == KERN_SUCCESS) {
                            const bool stop = visit(service, device);
                            IOObjectRelease(device);
                            if (stop) {
                                IOObjectRelease(service);
                                break;
                            }
                        }
                    }
                    IOObjectRelease(service);
                }
                IOObjectRelease(iterator);
                if (found) return;
            }
        }

        UsbInfo infoOf(io_object_t device) {
            UsbInfo info;
            info.vendorId = static_cast<int>(propertyNumber(device, "idVendor"));
            info.productId = static_cast<int>(propertyNumber(device, "idProduct"));
            info.serialNumber = propertyString(device, "kUSBSerialNumberString", "USB Serial Number");
            info.manufacturer = propertyString(device, "kUSBVendorString", "USB Vendor Name");
            info.product = propertyString(device, "kUSBProductString", "USB Product Name");
            info.locationId = propertyNumber(device, "locationID");
            return info;
        }
    }

    struct UsbDevice {
        Interface **interface = nullptr;
        UInt8 pipe = 0;
        std::atomic<bool> aborted{false};
    };

    void listUsb(std::vector<UsbInfo> &printers) {
        eachPrinterInterface([&printers](io_object_t service, io_object_t device) -> bool {
            UsbInfo info = infoOf(device);
            info.deviceId = deviceIdOf(device, static_cast<int>(propertyNumber(service, "bInterfaceNumber")), static_cast<int>(std::max<long long>(0, propertyNumber(service, "bAlternateSetting"))));
            printers.push_back(info);
            return false;
        });
    }

    UsbDevice *openUsb(const UsbTarget &target) {
        io_object_t chosen = 0;
        eachPrinterInterface([&](io_object_t service, io_object_t device) -> bool {
            const UsbInfo info = infoOf(device);
            if (info.vendorId != target.vendorId || info.productId != target.productId) return false;
            if (!target.serialNumber.empty() && info.serialNumber != target.serialNumber) return false;
            IOObjectRetain(service);
            chosen = service;
            return true;
        });
        if (!chosen) throw Failure{static_cast<long>(kIOReturnNotFound), "IOServiceGetMatchingServices", "The USB printer is not connected", "ENOENT"};
        Interface **interface = plugin<Interface>(chosen, kIOUSBInterfaceUserClientTypeID, kIOUSBInterfaceInterfaceID300);
        IOObjectRelease(chosen);
        if (!interface) throw Failure{static_cast<long>(kIOReturnError), "IOCreatePlugInInterfaceForService", "The USB printer cannot be reached", "EIO"};
        const IOReturn opened = (*interface)->USBInterfaceOpen(interface);
        if (opened != kIOReturnSuccess) {
            (*interface)->Release(interface);
            //A print queue of the system printing on it holds it
            if (opened == kIOReturnExclusiveAccess) fail("USBInterfaceOpen", opened, "EBUSY");
            fail("USBInterfaceOpen", opened);
        }
        UInt8 endpoints = 0;
        (*interface)->GetNumEndpoints(interface, &endpoints);
        UInt8 pipe = 0;
        for (UInt8 index = 1; index <= endpoints && !pipe; index++) {
            UInt8 direction = 0, number = 0, transfer = 0, interval = 0;
            UInt16 packet = 0;
            if ((*interface)->GetPipeProperties(interface, index, &direction, &number, &transfer, &packet, &interval) == kIOReturnSuccess && direction == kUSBOut && transfer == kUSBBulk) pipe = index;
        }
        if (!pipe) {
            (*interface)->USBInterfaceClose(interface);
            (*interface)->Release(interface);
            throw Failure{static_cast<long>(kIOReturnError), "GetPipeProperties", "The USB printer has no bulk output endpoint", "EIO"};
        }
        auto *device = new UsbDevice();
        device->interface = interface;
        device->pipe = pipe;
        return device;
    }

    void writeUsb(UsbDevice *device, const uint8_t *data, size_t length, int64_t stallMs) {
        //A transfer is failed once it moves nothing for the stall time (0 with 0: no limit)
        const UInt32 noData = stallMs > 0 ? static_cast<UInt32>(stallMs) : 0;
        size_t offset = 0;
        while (offset < length) {
            if (device->aborted) throw Failure{static_cast<long>(kIOReturnAborted), "WritePipeTO", "The printer is closed", "ECANCELED"};
            const UInt32 size = static_cast<UInt32>(std::min<size_t>(length - offset, 65536));
            const IOReturn written = (*device->interface)->WritePipeTO(device->interface, device->pipe, const_cast<uint8_t *>(data + offset), size, noData, 0);
            if (written == kIOUSBTransactionTimeout) {
                (*device->interface)->ClearPipeStallBothEnds(device->interface, device->pipe);
                throw Failure{static_cast<long>(written), "WritePipeTO", "The printer took no data for " + std::to_string(stallMs) + " ms", "ETIMEDOUT"};
            }
            if (written == kIOReturnAborted && device->aborted) throw Failure{static_cast<long>(written), "WritePipeTO", "The printer is closed", "ECANCELED"};
            if (written == kIOUSBPipeStalled) (*device->interface)->ClearPipeStallBothEnds(device->interface, device->pipe);
            if (written != kIOReturnSuccess) fail("WritePipeTO", written);
            offset += size;
        }
    }

    void abortUsb(UsbDevice *device) {
        device->aborted = true;
        (*device->interface)->AbortPipe(device->interface, device->pipe);
    }

    void closeUsb(UsbDevice *device) {
        (*device->interface)->USBInterfaceClose(device->interface);
        (*device->interface)->Release(device->interface);
        delete device;
    }

    void listQueues(std::vector<QueueInfo> &) {}

    void printRaw(const std::string &, const uint8_t *, size_t, const std::string &) {
        throw Failure{0, "", "The spooler is the one of Windows", "ENOTSUP"};
    }

    std::string nameOf(long code) {
        switch (static_cast<IOReturn>(code)) {
            case kIOReturnExclusiveAccess:
                return "EBUSY";
            case kIOReturnNotFound:
                return "ENOENT";
            case kIOReturnNoDevice:
            case kIOReturnNotResponding:
            case kIOReturnNotAttached:
                return "EIO";
            case kIOReturnAborted:
                return "ECANCELED";
            case kIOReturnNotPermitted:
            case kIOReturnNotPrivileged:
                return "EACCES";
            case kIOUSBTransactionTimeout:
            case kIOReturnTimeout:
                return "ETIMEDOUT";
            default:
                return "EUNKNOWN";
        }
    }

    std::string messageOf(long code) {
        return mach_error_string(static_cast<mach_error_t>(code));
    }
}

#endif
