#include <napi.h>

#include <chrono>
#include <memory>
#include <mutex>
#include <thread>
#include "Printer.h"

using namespace printer;

namespace {

    /**
     * An open USB printer of JavaScript: closed once, after the write running stops
     */
    struct Handle {
        UsbDevice *device = nullptr;
        std::atomic<bool> closed{false};
        std::atomic<int> busy{0};
    };

    using HandlePointer = std::shared_ptr<Handle>;

    Napi::Error errorOf(Napi::Env env, const Failure &failure) {
        Napi::Error error = Napi::Error::New(env, failure.detail.empty() ? messageOf(failure.code) : failure.detail);
        error.Set("code", Napi::String::New(env, failure.name.empty() ? nameOf(failure.code) : failure.name));
        error.Set("errno", Napi::Number::New(env, static_cast<double>(failure.code)));
        if (!failure.syscall.empty()) error.Set("syscall", Napi::String::New(env, failure.syscall));
        return error;
    }

    /**
     * An operation in the thread pool, settling a promise
     */
    class Operation : public Napi::AsyncWorker {
    public:
        explicit Operation(Napi::Env env, const char *name) : Napi::AsyncWorker(env, name), deferred(Napi::Promise::Deferred::New(env)) {}

        Napi::Promise promise() {
            return deferred.Promise();
        }

    protected:
        virtual void run() = 0;

        virtual Napi::Value result(Napi::Env env) {
            return env.Undefined();
        }

        void Execute() final {
            try {
                run();
            } catch (const Failure &caught) {
                failure = caught;
                failed = true;
            } catch (const std::exception &caught) {
                failure = Failure{0, "", caught.what(), "EUNKNOWN"};
                failed = true;
            }
        }

        void OnOK() final {
            Napi::Env env = Env();
            Napi::HandleScope scope(env);
            if (failed) deferred.Reject(errorOf(env, failure).Value());
            else deferred.Resolve(result(env));
        }

        Napi::Promise::Deferred deferred;
        bool failed = false;
        Failure failure;
    };

    template<typename T, typename... Arguments>
    Napi::Value queue(Arguments &&... arguments) {
        auto *operation = new T(std::forward<Arguments>(arguments)...);
        Napi::Promise promise = operation->promise();
        operation->Queue();
        return promise;
    }

    void setText(Napi::Object &object, const char *key, const std::string &value) {
        if (!value.empty()) object.Set(key, value);
    }

    class ListUsb : public Operation {
    public:
        explicit ListUsb(Napi::Env env) : Operation(env, "lakutata.printer.usbList") {}

    protected:
        void run() override {
            listUsb(printers);
        }

        Napi::Value result(Napi::Env env) override {
            Napi::Array list = Napi::Array::New(env, printers.size());
            for (size_t index = 0; index < printers.size(); index++) {
                const UsbInfo &info = printers[index];
                Napi::Object entry = Napi::Object::New(env);
                setText(entry, "path", info.path);
                if (info.vendorId >= 0) entry.Set("vendorId", info.vendorId);
                if (info.productId >= 0) entry.Set("productId", info.productId);
                setText(entry, "serialNumber", info.serialNumber);
                setText(entry, "manufacturer", info.manufacturer);
                setText(entry, "product", info.product);
                setText(entry, "deviceId", info.deviceId);
                if (info.locationId >= 0) entry.Set("locationId", static_cast<double>(info.locationId));
                list.Set(static_cast<uint32_t>(index), entry);
            }
            return list;
        }

    private:
        std::vector<UsbInfo> printers;
    };

    class OpenUsb : public Operation {
    public:
        OpenUsb(Napi::Env env, UsbTarget target) : Operation(env, "lakutata.printer.usbOpen"), target(std::move(target)) {}

    protected:
        void run() override {
            handle = std::make_shared<Handle>();
            handle->device = openUsb(target);
        }

        Napi::Value result(Napi::Env env) override {
            return Napi::External<HandlePointer>::New(env, new HandlePointer(handle), [](Napi::Env, HandlePointer *data) -> void {
                //Collected without its closing: closed now
                if (!(*data)->closed.exchange(true)) closeUsb((*data)->device);
                delete data;
            });
        }

    private:
        UsbTarget target;
        HandlePointer handle;
    };

    class WriteUsb : public Operation {
    public:
        WriteUsb(Napi::Env env, HandlePointer handle, Napi::Buffer<uint8_t> buffer, int64_t stall)
                : Operation(env, "lakutata.printer.usbWrite"), handle(std::move(handle)), kept(Napi::Persistent(buffer.As<Napi::Object>())), data(buffer.Data()), length(buffer.Length()), stall(stall) {
            this->handle->busy++;
        }

    protected:
        void run() override {
            struct Release {
                Handle *handle;

                ~Release() {
                    handle->busy--;
                }
            } release{handle.get()};
            if (handle->closed) throw Failure{0, "", "The printer is closed", "ECANCELED"};
            writeUsb(handle->device, data, length, stall);
        }

        Napi::Value result(Napi::Env env) override {
            return Napi::Number::New(env, static_cast<double>(length));
        }

    private:
        HandlePointer handle;
        Napi::ObjectReference kept;
        uint8_t *data;
        size_t length;
        int64_t stall;
    };

    class CloseUsb : public Operation {
    public:
        CloseUsb(Napi::Env env, HandlePointer handle) : Operation(env, "lakutata.printer.usbClose"), handle(std::move(handle)) {}

    protected:
        void run() override {
            if (handle->closed.exchange(true)) return;
            //The write running stopped, then the device closed
            if (handle->busy > 0) abortUsb(handle->device);
            while (handle->busy > 0) std::this_thread::sleep_for(std::chrono::milliseconds(2));
            closeUsb(handle->device);
        }

    private:
        HandlePointer handle;
    };

    class ListQueues : public Operation {
    public:
        explicit ListQueues(Napi::Env env) : Operation(env, "lakutata.printer.queueList") {}

    protected:
        void run() override {
            listQueues(queues);
        }

        Napi::Value result(Napi::Env env) override {
            Napi::Array list = Napi::Array::New(env, queues.size());
            for (size_t index = 0; index < queues.size(); index++) {
                Napi::Object entry = Napi::Object::New(env);
                entry.Set("name", queues[index].name);
                setText(entry, "driver", queues[index].driver);
                setText(entry, "port", queues[index].port);
                entry.Set("isDefault", queues[index].isDefault);
                list.Set(static_cast<uint32_t>(index), entry);
            }
            return list;
        }

    private:
        std::vector<QueueInfo> queues;
    };

    class PrintRaw : public Operation {
    public:
        PrintRaw(Napi::Env env, std::string name, Napi::Buffer<uint8_t> buffer, std::string document)
                : Operation(env, "lakutata.printer.queuePrint"), name(std::move(name)), kept(Napi::Persistent(buffer.As<Napi::Object>())), data(buffer.Data()), length(buffer.Length()), document(std::move(document)) {}

    protected:
        void run() override {
            printRaw(name, data, length, document);
        }

    private:
        std::string name;
        Napi::ObjectReference kept;
        uint8_t *data;
        size_t length;
        std::string document;
    };

    HandlePointer handleOf(const Napi::Value &value) {
        if (!value.IsExternal()) throw Napi::TypeError::New(value.Env(), "Not a USB printer");
        return *value.As<Napi::External<HandlePointer>>().Data();
    }

    Napi::Value UsbList(const Napi::CallbackInfo &info) {
        return queue<ListUsb>(info.Env());
    }

    Napi::Value UsbOpen(const Napi::CallbackInfo &info) {
        Napi::Object object = info[0].As<Napi::Object>();
        UsbTarget target;
        if (object.Get("path").IsString()) target.path = object.Get("path").As<Napi::String>().Utf8Value();
        if (object.Get("vendorId").IsNumber()) target.vendorId = object.Get("vendorId").As<Napi::Number>().Int32Value();
        if (object.Get("productId").IsNumber()) target.productId = object.Get("productId").As<Napi::Number>().Int32Value();
        if (object.Get("serialNumber").IsString()) target.serialNumber = object.Get("serialNumber").As<Napi::String>().Utf8Value();
        return queue<OpenUsb>(info.Env(), std::move(target));
    }

    Napi::Value UsbWrite(const Napi::CallbackInfo &info) {
        return queue<WriteUsb>(info.Env(), handleOf(info[0]), info[1].As<Napi::Buffer<uint8_t>>(), static_cast<int64_t>(info[2].As<Napi::Number>().DoubleValue()));
    }

    Napi::Value UsbClose(const Napi::CallbackInfo &info) {
        return queue<CloseUsb>(info.Env(), handleOf(info[0]));
    }

    Napi::Value QueueList(const Napi::CallbackInfo &info) {
        return queue<ListQueues>(info.Env());
    }

    Napi::Value QueuePrint(const Napi::CallbackInfo &info) {
        return queue<PrintRaw>(info.Env(), info[0].As<Napi::String>().Utf8Value(), info[1].As<Napi::Buffer<uint8_t>>(), info[2].As<Napi::String>().Utf8Value());
    }

    Napi::Object Init(Napi::Env env, Napi::Object exports) {
        exports.Set("usbList", Napi::Function::New(env, UsbList));
        exports.Set("usbOpen", Napi::Function::New(env, UsbOpen));
        exports.Set("usbWrite", Napi::Function::New(env, UsbWrite));
        exports.Set("usbClose", Napi::Function::New(env, UsbClose));
        exports.Set("queueList", Napi::Function::New(env, QueueList));
        exports.Set("queuePrint", Napi::Function::New(env, QueuePrint));
        return exports;
    }
}

NODE_API_MODULE(thermal_printer, Init)
