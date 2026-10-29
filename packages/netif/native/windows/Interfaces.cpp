//The interfaces of Windows, read by GetAdaptersAddresses(): the name of an interface is the name of its network
//connection (以太网, Ethernet 2…, in the language of the system). A disabled adapter is not listed: listed is enabled. The
//duplicate address detection of an address is its DadState.
#include "../Interfaces.h"

#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>

#include <system_error>
#include <utility>
#include <vector>

namespace netif {

namespace {

std::string utf8(const wchar_t *text)
{
    if (!text || !*text) return std::string();
    int length = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    if (length <= 1) return std::string();
    std::string converted(static_cast<size_t>(length - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, -1, converted.data(), length, nullptr, nullptr);
    return converted;
}

}

std::vector<Interface> listInterfaces()
{
    const ULONG flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
    std::vector<unsigned char> buffer(16384);
    ULONG size = static_cast<ULONG>(buffer.size());
    ULONG result = ERROR_BUFFER_OVERFLOW;
    //The size asked can grow between two calls (an adapter added meanwhile)
    for (int attempt = 0; attempt < 4 && result == ERROR_BUFFER_OVERFLOW; attempt++) {
        buffer.resize(size);
        result = GetAdaptersAddresses(AF_UNSPEC, flags, nullptr, reinterpret_cast<IP_ADAPTER_ADDRESSES *>(buffer.data()), &size);
    }
    std::vector<Interface> interfaces;
    if (result == ERROR_NO_DATA) return interfaces;
    if (result != NO_ERROR) throw std::system_error(static_cast<int>(result), std::system_category(), "GetAdaptersAddresses");
    for (auto *adapter = reinterpret_cast<IP_ADAPTER_ADDRESSES *>(buffer.data()); adapter; adapter = adapter->Next) {
        Interface entry;
        entry.name = utf8(adapter->FriendlyName);
        entry.index = adapter->IfIndex ? adapter->IfIndex : adapter->Ipv6IfIndex;
        entry.mac = macText(adapter->PhysicalAddress, adapter->PhysicalAddressLength);
        entry.up = true;
        entry.running = adapter->OperStatus == IfOperStatusUp;
        entry.loopback = adapter->IfType == IF_TYPE_SOFTWARE_LOOPBACK;
        for (auto *unicast = adapter->FirstUnicastAddress; unicast; unicast = unicast->Next) {
            const sockaddr *socketAddress = unicast->Address.lpSockaddr;
            if (!socketAddress) continue;
            Address address;
            if (socketAddress->sa_family == AF_INET) {
                address.family = 4;
                address.address = addressText(AF_INET, &reinterpret_cast<const sockaddr_in *>(socketAddress)->sin_addr);
            } else if (socketAddress->sa_family == AF_INET6) {
                auto *in6 = reinterpret_cast<const sockaddr_in6 *>(socketAddress);
                address.family = 6;
                address.address = addressText(AF_INET6, &in6->sin6_addr);
                //The scope the system gives (as os.networkInterfaces() does): the interface of a link-local address, the
                //site of a site-local one (fec0::/10)
                address.scopeId = in6->sin6_scope_id;
            } else {
                continue;
            }
            address.prefixLength = unicast->OnLinkPrefixLength;
            address.tentative = unicast->DadState != IpDadStatePreferred && unicast->DadState != IpDadStateDeprecated;
            entry.addresses.push_back(std::move(address));
        }
        interfaces.push_back(std::move(entry));
    }
    return interfaces;
}

}
