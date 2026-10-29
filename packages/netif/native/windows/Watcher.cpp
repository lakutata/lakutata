//The notifications of Windows: the changes of the IP interfaces (their arrival, removal and settings: the link state,
//the weak host model, the forwarding) and of the unicast addresses, whose callbacks run in threads of the system.
//CancelMibChangeNotify2 waits for the callbacks running: called by the destructor only, never from a callback.
#include "../Watcher.h"

#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>

#include <system_error>

namespace netif {

struct Watcher::State {
    std::function<void()> changed;
    HANDLE interfaces = nullptr;
    HANDLE addresses = nullptr;
};

namespace {

VOID NETIOAPI_API_ onInterface(PVOID context, PMIB_IPINTERFACE_ROW, MIB_NOTIFICATION_TYPE)
{
    (*static_cast<std::function<void()> *>(context))();
}

VOID NETIOAPI_API_ onAddress(PVOID context, PMIB_UNICASTIPADDRESS_ROW, MIB_NOTIFICATION_TYPE)
{
    (*static_cast<std::function<void()> *>(context))();
}

}

Watcher::Watcher(std::function<void()> changed) : state(std::make_unique<State>())
{
    state->changed = std::move(changed);
    DWORD result = NotifyIpInterfaceChange(AF_UNSPEC, onInterface, &state->changed, FALSE, &state->interfaces);
    if (result != NO_ERROR) throw std::system_error(static_cast<int>(result), std::system_category(), "NotifyIpInterfaceChange");
    result = NotifyUnicastIpAddressChange(AF_UNSPEC, onAddress, &state->changed, FALSE, &state->addresses);
    if (result != NO_ERROR) {
        CancelMibChangeNotify2(state->interfaces);
        state->interfaces = nullptr;
        throw std::system_error(static_cast<int>(result), std::system_category(), "NotifyUnicastIpAddressChange");
    }
}

Watcher::~Watcher()
{
    if (state->addresses) CancelMibChangeNotify2(state->addresses);
    if (state->interfaces) CancelMibChangeNotify2(state->interfaces);
}

}
