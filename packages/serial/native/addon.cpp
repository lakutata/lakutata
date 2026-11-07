#include <napi.h>

#include <chrono>
#include <memory>
#include "Port.h"
#include "Session.h"

using namespace serial;

namespace {

    struct Handle;

    void deliver(Napi::Env env, Napi::Function callback, Handle *handle, Event *event);

    using Events = Napi::TypedThreadSafeFunction<Handle, Event, deliver>;

    /**
     * A port of JavaScript: its port (and thread), the thread-safe function its events go through, and whether its
     * thread was joined and the function released (once it closed, or when the environment ends)
     */
    struct Handle {
        std::shared_ptr<Port> port;
        Events events;
        napi_env env = nullptr;
        bool cleaned = false;
    };

    void environmentEnds(void *data);

    /**
     * The end of a port: its thread joined, the hook of the environment removed, the function released
     */
    void finish(Handle *handle, bool removeHook) {
        if (handle->cleaned) return;
        handle->cleaned = true;
        if (handle->port->thread.joinable()) handle->port->thread.join();
        if (removeHook) napi_remove_env_cleanup_hook(handle->env, environmentEnds, handle);
        handle->events.Release();
    }

    /**
     * The environment ends (a worker terminated, the process exiting) with the port open: its thread stops before
     * the thread-safe function is torn down (this hook was added after the function, so it runs before the function's)
     */
    void environmentEnds(void *data) {
        auto *handle = static_cast<Handle *>(data);
        if (handle->cleaned) return;
        Command command;
        command.kind = CommandKind::Close;
        command.discard = true;
        handle->port->push(command);
        //A thread stuck in the system (a Bluetooth port still connecting, a wedged adapter) is waited for a while,
        //then left: its events silenced before the thread-safe function goes
        const auto until = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        while (!handle->port->finished && std::chrono::steady_clock::now() < until) std::this_thread::sleep_for(std::chrono::milliseconds(5));
        {
            std::lock_guard<std::mutex> lock(handle->port->postMutex);
            handle->port->silenced = true;
        }
        if (!handle->port->finished && handle->port->thread.joinable()) handle->port->thread.detach();
        finish(handle, false);
    }

    Napi::Error errorOf(Napi::Env env, const Failure &failure) {
        Napi::Error error = Napi::Error::New(env, failure.detail.empty() ? messageOf(failure.code) : failure.detail);
        error.Set("code", Napi::String::New(env, failure.name.empty() ? nameOf(failure.code) : failure.name));
        error.Set("errno", Napi::Number::New(env, static_cast<double>(failure.code)));
        if (!failure.syscall.empty()) error.Set("syscall", Napi::String::New(env, failure.syscall));
        error.Set("disconnected", Napi::Boolean::New(env, failure.disconnected));
        return error;
    }

    void deliver(Napi::Env env, Napi::Function callback, Handle *handle, Event *event) {
        std::unique_ptr<Event> owned(event);
        //The function torn down with events left: nothing to call
        if (env == nullptr || callback.IsEmpty()) return;
        Napi::HandleScope scope(env);
        Napi::Value value = env.Undefined();
        const char *kind = "result";
        switch (event->kind) {
            case EventKind::Opened:
                kind = "opened";
                break;
            case EventKind::Result:
                if (event->hasSignals) {
                    Napi::Object signals = Napi::Object::New(env);
                    signals.Set("cts", event->cts);
                    signals.Set("dsr", event->dsr);
                    signals.Set("dcd", event->dcd);
                    signals.Set("ri", event->ri);
                    value = signals;
                }
                break;
            case EventKind::Failed:
                kind = "failed";
                value = errorOf(env, event->failure).Value();
                break;
            case EventKind::Data:
                kind = "data";
                value = Napi::Buffer<uint8_t>::Copy(env, event->data.data(), event->data.size());
                break;
            case EventKind::Fatal:
                kind = "fatal";
                value = errorOf(env, event->failure).Value();
                break;
            case EventKind::Closed:
                kind = "closed";
                //The last event of the thread: it ends now
                finish(handle, true);
                break;
        }
        callback.Call({Napi::String::New(env, kind), Napi::Number::New(env, event->id), value});
    }

    Handle *handleOf(const Napi::Value &value) {
        if (!value.IsExternal()) throw Napi::TypeError::New(value.Env(), "Not a port");
        Handle *handle = value.As<Napi::External<Handle>>().Data();
        if (handle->cleaned) {
            Napi::Error error = Napi::Error::New(value.Env(), "The port is closed");
            error.Set("code", Napi::String::New(value.Env(), "ECANCELED"));
            throw error;
        }
        return handle;
    }

    LineOptions optionsOf(const Napi::Object &object) {
        LineOptions options;
        options.baudRate = object.Get("baudRate").As<Napi::Number>().Uint32Value();
        options.dataBits = object.Get("dataBits").As<Napi::Number>().Int32Value();
        const double stopBits = object.Get("stopBits").As<Napi::Number>().DoubleValue();
        options.stopBits = stopBits == 2 ? 2 : stopBits == 1.5 ? 15 : 1;
        options.parity = object.Get("parity").As<Napi::String>().Utf8Value()[0];
        const std::string flow = object.Get("flowControl").As<Napi::String>().Utf8Value();
        options.flowControl = flow == "rts/cts" ? 1 : flow == "xon/xoff" ? 2 : flow == "dtr/dsr" ? 3 : 0;
        options.stallTimeout = static_cast<int64_t>(object.Get("stallTimeout").As<Napi::Number>().DoubleValue());
        return options;
    }

    /**
     * open(path, settings, exclusive, onEvent): the port, opened by its thread; its events go to onEvent(kind, id,
     * value): 'opened', 'result', 'failed', 'data', 'fatal', 'closed'
     */
    Napi::Value Open(const Napi::CallbackInfo &info) {
        Napi::Env env = info.Env();
        auto port = std::make_shared<Port>();
        port->path = info[0].As<Napi::String>().Utf8Value();
        port->options = optionsOf(info[1].As<Napi::Object>());
        port->exclusive = info[2].As<Napi::Boolean>().Value();
        auto *handle = new Handle();
        handle->port = port;
        handle->env = env;
        handle->events = Events::New(env, info[3].As<Napi::Function>(), "lakutata.serial", 0, 1, handle);
        Events events = handle->events;
        Port *owner = port.get();
        port->post = [events, owner](Event *event) mutable -> void {
            std::lock_guard<std::mutex> lock(owner->postMutex);
            if (owner->silenced || events.NonBlockingCall(event) != napi_ok) delete event;
        };
        napi_add_env_cleanup_hook(env, environmentEnds, handle);
        port->thread = std::thread([port]() -> void {
            run(*port);
        });
        return Napi::External<Handle>::New(env, handle, [](Napi::Env, Handle *data) -> void {
            //Collected once closed (the thread-safe function holds the callback, and through it the port, until then)
            delete data;
        });
    }

    void push(const Napi::CallbackInfo &info, Command command) {
        Handle *handle = handleOf(info[0]);
        command.id = info[1].As<Napi::Number>().Uint32Value();
        handle->port->push(std::move(command));
    }

    Napi::Value Write(const Napi::CallbackInfo &info) {
        Command command;
        command.kind = CommandKind::Write;
        Napi::Buffer<uint8_t> buffer = info[2].As<Napi::Buffer<uint8_t>>();
        command.data.assign(buffer.Data(), buffer.Data() + buffer.Length());
        push(info, std::move(command));
        return info.Env().Undefined();
    }

    Napi::Value Drain(const Napi::CallbackInfo &info) {
        Command command;
        command.kind = CommandKind::Drain;
        command.stall = static_cast<int64_t>(info[2].As<Napi::Number>().DoubleValue());
        const auto limit = static_cast<int64_t>(info[3].As<Napi::Number>().DoubleValue());
        command.deadline = limit > 0 ? steadyMs() + limit : 0;
        push(info, std::move(command));
        return info.Env().Undefined();
    }

    Napi::Value Configure(const Napi::CallbackInfo &info) {
        Command command;
        command.kind = CommandKind::Configure;
        command.options = optionsOf(info[2].As<Napi::Object>());
        push(info, std::move(command));
        return info.Env().Undefined();
    }

    Napi::Value Flush(const Napi::CallbackInfo &info) {
        Command command;
        command.kind = CommandKind::Flush;
        command.input = info[2].As<Napi::Boolean>().Value();
        command.output = info[3].As<Napi::Boolean>().Value();
        push(info, std::move(command));
        return info.Env().Undefined();
    }

    Napi::Value Signals(const Napi::CallbackInfo &info) {
        Command command;
        command.kind = CommandKind::Signals;
        push(info, std::move(command));
        return info.Env().Undefined();
    }

    Napi::Value SetSignals(const Napi::CallbackInfo &info) {
        Command command;
        command.kind = CommandKind::SetSignals;
        command.dtr = info[2].As<Napi::Number>().Int32Value();
        command.rts = info[3].As<Napi::Number>().Int32Value();
        command.brk = info[4].As<Napi::Number>().Int32Value();
        push(info, std::move(command));
        return info.Env().Undefined();
    }

    /**
     * read(port, wanted): whether the thread reads (the stream wants data)
     */
    Napi::Value Read(const Napi::CallbackInfo &info) {
        Handle *handle = handleOf(info[0]);
        Command command;
        command.kind = CommandKind::Read;
        command.wanted = info[1].As<Napi::Boolean>().Value();
        handle->port->push(std::move(command));
        return info.Env().Undefined();
    }

    Napi::Value Close(const Napi::CallbackInfo &info) {
        Command command;
        command.kind = CommandKind::Close;
        command.discard = info[2].As<Napi::Boolean>().Value();
        push(info, std::move(command));
        return info.Env().Undefined();
    }

    /**
     * The listing of the ports, in the thread pool (SetupAPI may take a while)
     */
    class ListOperation : public Napi::AsyncWorker {
    public:
        explicit ListOperation(Napi::Env env) : Napi::AsyncWorker(env, "lakutata.serial.list"), deferred(Napi::Promise::Deferred::New(env)) {}

        Napi::Promise promise() {
            return deferred.Promise();
        }

    protected:
        void Execute() override {
            listed = listPorts(ports);
        }

        void OnOK() override {
            Napi::Env env = Env();
            Napi::HandleScope scope(env);
            if (!listed) return deferred.Resolve(env.Null());
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
            deferred.Resolve(result);
        }

        void OnError(const Napi::Error &error) override {
            deferred.Reject(error.Value());
        }

    private:
        Napi::Promise::Deferred deferred;
        std::vector<PortInfo> ports;
        bool listed = false;
    };

    Napi::Value List(const Napi::CallbackInfo &info) {
        auto *operation = new ListOperation(info.Env());
        Napi::Promise promise = operation->promise();
        operation->Queue();
        return promise;
    }

    Napi::Object Init(Napi::Env env, Napi::Object exports) {
        exports.Set("open", Napi::Function::New(env, Open));
        exports.Set("write", Napi::Function::New(env, Write));
        exports.Set("drain", Napi::Function::New(env, Drain));
        exports.Set("configure", Napi::Function::New(env, Configure));
        exports.Set("flush", Napi::Function::New(env, Flush));
        exports.Set("signals", Napi::Function::New(env, Signals));
        exports.Set("setSignals", Napi::Function::New(env, SetSignals));
        exports.Set("read", Napi::Function::New(env, Read));
        exports.Set("close", Napi::Function::New(env, Close));
        exports.Set("list", Napi::Function::New(env, List));
        return exports;
    }
}

NODE_API_MODULE(serial, Init)
