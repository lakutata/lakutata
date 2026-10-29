//The addon of @lakutata/netif: what Node.js cannot do by itself, given to JavaScript by Node-API (through
//node-addon-api). The errors of the system are thrown as errors with the code of the system (code, errno, syscall).
#include <napi.h>

#include <system_error>

#include "Interfaces.h"

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

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("list", Napi::Function::New(env, List));
    return exports;
}

}

NODE_API_MODULE(netif, Init)
