#include <napi.h>

#include <cerrno>
#include <chrono>
#include <memory>
#include <thread>
#include "Port.h"

using namespace serial;

namespace {

    using PortPointer = std::shared_ptr<Port>;

    /**
     * A port of the addon: closed when the last of its holders lets it go, if no one closed it before
     */
    PortPointer newPort(const std::string &path) {
        PortPointer port(new Port(), [](Port *port) -> void {
            if (!port->closed) {
                try {
                    closePort(*port, true);
                } catch (...) {
                }
            }
            delete port;
        });
        port->path = path;
        return port;
    }

    Napi::Error errorOf(Napi::Env env, const Failure &failure) {
        Napi::Error error = Napi::Error::New(env, failure.detail.empty() ? messageOf(failure.code) : failure.detail);
        error.Set("code", Napi::String::New(env, nameOf(failure.code)));
        error.Set("errno", Napi::Number::New(env, static_cast<double>(failure.code)));
        error.Set("syscall", Napi::String::New(env, failure.syscall));
        return error;
    }

    [[noreturn]] void throwFailure(Napi::Env env, const Failure &failure) {
        throw errorOf(env, failure);
    }

    PortPointer portOf(const Napi::Value &value) {
        if (!value.IsExternal()) throw Napi::TypeError::New(value.Env(), "Not a port");
        return *value.As<Napi::External<PortPointer>>().Data();
    }

    /**
     * A port open: not closing
     */
    PortPointer openOf(const Napi::Value &value) {
        PortPointer port = portOf(value);
#ifdef _WIN32
        constexpr long CLOSED = ERROR_OPERATION_ABORTED;
#else
        constexpr long CLOSED = ECANCELED;
#endif
        if (port->closing) throwFailure(value.Env(), Failure{CLOSED, "", "The port is closed"});
        return port;
    }

    LineOptions optionsOf(const Napi::Object &object) {
        LineOptions options;
        options.baudRate = object.Get("baudRate").As<Napi::Number>().Uint32Value();
        options.dataBits = object.Get("dataBits").As<Napi::Number>().Int32Value();
        const double stopBits = object.Get("stopBits").As<Napi::Number>().DoubleValue();
        options.stopBits = stopBits == 2 ? 2 : stopBits == 1.5 ? 15 : 1;
        options.parity = object.Get("parity").As<Napi::String>().Utf8Value()[0];
        const std::string flow = object.Get("flowControl").As<Napi::String>().Utf8Value();
        options.flowControl = flow == "rts/cts" ? 1 : flow == "xon/xoff" ? 2 : 0;
        return options;
    }

    /**
     * An operation of a port in the thread pool, settling a promise: counted until it ends, so that the closing waits
     * for it
     */
    class Operation : public Napi::AsyncWorker {
    public:
        Operation(Napi::Env env, PortPointer port, const char *name, bool counted = true)
                : Napi::AsyncWorker(env, name), deferred(Napi::Promise::Deferred::New(env)), port(std::move(port)), counted(counted) {
            if (counted) this->port->busy++;
        }

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
                failure = Failure{0, "", caught.what()};
                failed = true;
            }
            if (counted) port->busy--;
        }

        void OnOK() final {
            Napi::Env env = Env();
            Napi::HandleScope scope(env);
            if (failed) deferred.Reject(errorOf(env, failure).Value());
            else deferred.Resolve(result(env));
        }

        Napi::Promise::Deferred deferred;
        PortPointer port;
        bool counted;
        bool failed = false;
        Failure failure;
    };

    class OpenOperation : public Operation {
    public:
        OpenOperation(Napi::Env env, PortPointer port, LineOptions options, bool exclusive)
                : Operation(env, std::move(port), "lakutata.serial.open", false), options(options), exclusive(exclusive) {}

    protected:
        void run() override {
            openPort(*port, options, exclusive);
        }

        Napi::Value result(Napi::Env env) override {
            return Napi::External<PortPointer>::New(env, new PortPointer(port), [](Napi::Env, PortPointer *data) -> void {
                delete data;
            });
        }

    private:
        LineOptions options;
        bool exclusive;
    };

    /**
     * A read or a write of a slice, into or from a buffer kept alive until it ends
     */
    class TransferOperation : public Operation {
    public:
        TransferOperation(Napi::Env env, PortPointer port, Napi::Buffer<uint8_t> buffer, bool reading)
                : Operation(env, std::move(port), reading ? "lakutata.serial.read" : "lakutata.serial.write"),
                  kept(Napi::Persistent(buffer.As<Napi::Object>())), data(buffer.Data()), length(buffer.Length()), reading(reading) {}

    protected:
        void run() override {
            transferred = reading ? readSlice(*port, data, length) : writeSlice(*port, data, length);
        }

        Napi::Value result(Napi::Env env) override {
            return Napi::Number::New(env, static_cast<double>(transferred));
        }

    private:
        Napi::ObjectReference kept;
        uint8_t *data;
        size_t length;
        bool reading;
        size_t transferred = 0;
    };

    class DrainOperation : public Operation {
    public:
        DrainOperation(Napi::Env env, PortPointer port) : Operation(env, std::move(port), "lakutata.serial.drain") {}

    protected:
        void run() override {
            drainPort(*port);
        }
    };

    class CloseOperation : public Operation {
    public:
        CloseOperation(Napi::Env env, PortPointer port, bool discard)
                : Operation(env, std::move(port), "lakutata.serial.close", false), discard(discard) {}

    protected:
        void run() override {
            //The operations running end within their slice
            while (port->busy > 0) std::this_thread::sleep_for(std::chrono::milliseconds(2));
            closePort(*port, discard);
            port->closed = true;
        }

    private:
        bool discard;
    };

    Napi::Value Open(const Napi::CallbackInfo &info) {
        Napi::Env env = info.Env();
        PortPointer port = newPort(info[0].As<Napi::String>().Utf8Value());
        auto *operation = new OpenOperation(env, port, optionsOf(info[1].As<Napi::Object>()), info[2].As<Napi::Boolean>().Value());
        Napi::Promise promise = operation->promise();
        operation->Queue();
        return promise;
    }

    Napi::Value Configure(const Napi::CallbackInfo &info) {
        PortPointer port = openOf(info[0]);
        try {
            configurePort(*port, optionsOf(info[1].As<Napi::Object>()));
        } catch (const Failure &failure) {
            throwFailure(info.Env(), failure);
        }
        return info.Env().Undefined();
    }

    Napi::Value Transfer(const Napi::CallbackInfo &info, bool reading) {
        auto *operation = new TransferOperation(info.Env(), openOf(info[0]), info[1].As<Napi::Buffer<uint8_t>>(), reading);
        Napi::Promise promise = operation->promise();
        operation->Queue();
        return promise;
    }

    Napi::Value Write(const Napi::CallbackInfo &info) {
        return Transfer(info, false);
    }

    Napi::Value Read(const Napi::CallbackInfo &info) {
        return Transfer(info, true);
    }

    Napi::Value Drain(const Napi::CallbackInfo &info) {
        auto *operation = new DrainOperation(info.Env(), openOf(info[0]));
        Napi::Promise promise = operation->promise();
        operation->Queue();
        return promise;
    }

    Napi::Value Flush(const Napi::CallbackInfo &info) {
        PortPointer port = openOf(info[0]);
        try {
            flushPort(*port, info[1].As<Napi::Boolean>().Value(), info[2].As<Napi::Boolean>().Value());
        } catch (const Failure &failure) {
            throwFailure(info.Env(), failure);
        }
        return info.Env().Undefined();
    }

    Napi::Value Close(const Napi::CallbackInfo &info) {
        Napi::Env env = info.Env();
        PortPointer port = portOf(info[0]);
        //Closed once: a second closing settles at once
        if (port->closing.exchange(true)) {
            Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
            deferred.Resolve(env.Undefined());
            return deferred.Promise();
        }
        auto *operation = new CloseOperation(env, port, info[1].As<Napi::Boolean>().Value());
        Napi::Promise promise = operation->promise();
        operation->Queue();
        return promise;
    }

    Napi::Value Signals(const Napi::CallbackInfo &info) {
        Napi::Env env = info.Env();
        PortPointer port = openOf(info[0]);
        bool cts = false, dsr = false, dcd = false, ri = false;
        try {
            signalsOf(*port, cts, dsr, dcd, ri);
        } catch (const Failure &failure) {
            throwFailure(env, failure);
        }
        Napi::Object result = Napi::Object::New(env);
        result.Set("cts", cts);
        result.Set("dsr", dsr);
        result.Set("dcd", dcd);
        result.Set("ri", ri);
        return result;
    }

    Napi::Value SetSignals(const Napi::CallbackInfo &info) {
        PortPointer port = openOf(info[0]);
        try {
            setSignals(*port, info[1].As<Napi::Number>().Int32Value(), info[2].As<Napi::Number>().Int32Value(), info[3].As<Napi::Number>().Int32Value());
        } catch (const Failure &failure) {
            throwFailure(info.Env(), failure);
        }
        return info.Env().Undefined();
    }

    Napi::Value List(const Napi::CallbackInfo &info) {
        Napi::Env env = info.Env();
        std::vector<PortInfo> ports;
        if (!listPorts(ports)) return env.Null();
        Napi::Array result = Napi::Array::New(env, ports.size());
        for (size_t index = 0; index < ports.size(); index++) {
            const PortInfo &port = ports[index];
            Napi::Object entry = Napi::Object::New(env);
            entry.Set("path", port.path);
            if (port.vendorId >= 0) entry.Set("vendorId", port.vendorId);
            if (port.productId >= 0) entry.Set("productId", port.productId);
            if (!port.serialNumber.empty()) entry.Set("serialNumber", port.serialNumber);
            if (!port.manufacturer.empty()) entry.Set("manufacturer", port.manufacturer);
            if (!port.product.empty()) entry.Set("product", port.product);
            result.Set(static_cast<uint32_t>(index), entry);
        }
        return result;
    }

    Napi::Object Init(Napi::Env env, Napi::Object exports) {
        exports.Set("open", Napi::Function::New(env, Open));
        exports.Set("configure", Napi::Function::New(env, Configure));
        exports.Set("write", Napi::Function::New(env, Write));
        exports.Set("read", Napi::Function::New(env, Read));
        exports.Set("drain", Napi::Function::New(env, Drain));
        exports.Set("flush", Napi::Function::New(env, Flush));
        exports.Set("close", Napi::Function::New(env, Close));
        exports.Set("signals", Napi::Function::New(env, Signals));
        exports.Set("setSignals", Napi::Function::New(env, SetSignals));
        exports.Set("list", Napi::Function::New(env, List));
        return exports;
    }
}

NODE_API_MODULE(serial, Init)
