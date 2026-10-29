//The addon of @lakutata/netif: what Node.js cannot do by itself, given to JavaScript by Node-API (through
//node-addon-api). The errors of the system are thrown as errors with the code of the system (code, errno, syscall).
#include <napi.h>

#include <atomic>
#include <memory>
#include <system_error>

#include "Interfaces.h"
#include "Watcher.h"

using namespace netif;

namespace {

//An error of the system as a JavaScript error: its message, the number (errno) and the call (syscall) it came from
Napi::Error systemError(Napi::Env env, const std::system_error &error)
{
    Napi::Error thrown = Napi::Error::New(env, error.what());
    thrown.Set("errno", Napi::Number::New(env, error.code().value()));
    thrown.Set("syscall", Napi::String::New(env, error.what()));
    return thrown;
}

Napi::Object addressObject(Napi::Env env, const Address &address)
{
    Napi::Object object = Napi::Object::New(env);
    object.Set("address", address.address);
    object.Set("family", address.family == 4 ? "IPv4" : "IPv6");
    object.Set("prefixLength", address.prefixLength);
    object.Set("tentative", address.tentative);
    if (address.family == 6) object.Set("scopeid", address.scopeId);
    return object;
}

//list(): every interface of the machine, as [{name, index, mac?, up, running, loopback, addresses}]
Napi::Value List(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    std::vector<Interface> interfaces;
    try {
        interfaces = listInterfaces();
    } catch (const std::system_error &error) {
        throw systemError(env, error);
    }
    Napi::Array list = Napi::Array::New(env, interfaces.size());
    for (size_t index = 0; index < interfaces.size(); index++) {
        const Interface &entry = interfaces[index];
        Napi::Object object = Napi::Object::New(env);
        object.Set("name", entry.name);
        object.Set("index", entry.index);
        if (!entry.mac.empty()) object.Set("mac", entry.mac);
        object.Set("up", entry.up);
        object.Set("running", entry.running);
        object.Set("loopback", entry.loopback);
        Napi::Array addresses = Napi::Array::New(env, entry.addresses.size());
        for (size_t position = 0; position < entry.addresses.size(); position++) {
            addresses.Set(static_cast<uint32_t>(position), addressObject(env, entry.addresses[position]));
        }
        object.Set("addresses", addresses);
        list.Set(static_cast<uint32_t>(index), object);
    }
    return list;
}

//The watching of an environment (the main thread, or a worker): the notifications of the system, and the function they
//call JavaScript by. A notification only signals a change: while one waits to be delivered, the next ones are dropped.
//The function does not keep the event loop alive.
struct Watching {
    std::unique_ptr<Watcher> watcher;
    Napi::ThreadSafeFunction function;
    std::shared_ptr<std::atomic<bool>> pending = std::make_shared<std::atomic<bool>>(false);

    //The notifications stopped first (no call once the watcher is gone), then the function released
    void stop()
    {
        if (!watcher) return;
        watcher.reset();
        function.Release();
    }
};

struct Environment {
    Watching watching;
};

Environment &environmentOf(Napi::Env env)
{
    return **env.GetInstanceData<std::shared_ptr<Environment>>();
}

//watch(changed): the notifications of the changes of the interfaces start, changed() called (with no argument) at each
//one; once only by environment
Napi::Value Watch(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    Watching &watching = environmentOf(env).watching;
    if (watching.watcher) throw Napi::Error::New(env, "The interfaces are watched already");
    if (!info[0].IsFunction()) throw Napi::TypeError::New(env, "watch() takes a function");
    Napi::ThreadSafeFunction function = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "lakutata-netif", 0, 1);
    function.Unref(env);
    std::shared_ptr<std::atomic<bool>> pending = watching.pending;
    pending->store(false);
    try {
        watching.watcher = std::make_unique<Watcher>([function, pending]() mutable {
            if (pending->exchange(true)) return;
            napi_status status = function.NonBlockingCall([pending](Napi::Env, Napi::Function changed) {
                pending->store(false);
                changed.Call({});
            });
            if (status != napi_ok) pending->store(false);
        });
    } catch (const std::system_error &error) {
        function.Release();
        throw systemError(env, error);
    }
    watching.function = function;
    return env.Undefined();
}

//unwatch(): the notifications stopped
Napi::Value Unwatch(const Napi::CallbackInfo &info)
{
    environmentOf(info.Env()).watching.stop();
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    //Shared with the cleanup hook: alive whichever of the hook and the instance data goes first
    auto environment = std::make_shared<Environment>();
    env.SetInstanceData(new std::shared_ptr<Environment>(environment));
    //Before the environment ends (a worker terminated, the process exiting): the notifications stopped
    env.AddCleanupHook([environment]() {
        environment->watching.stop();
    });
    exports.Set("list", Napi::Function::New(env, List));
    exports.Set("watch", Napi::Function::New(env, Watch));
    exports.Set("unwatch", Napi::Function::New(env, Unwatch));
    return exports;
}

}

NODE_API_MODULE(netif, Init)
