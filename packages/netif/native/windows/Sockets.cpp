//Windows: no socket of an interface (IP_UNICAST_IF only chooses the interface the packets leave by); the strong host
//model of the system refuses the packets of an address that come through another interface. Whether a packet is taken
//depends on the settings of the interface it came through: every other interface of the family has to receive with the
//strong host model and not forward (whether forwarding suspends the model is not documented: counted as weak).
#include "../Sockets.h"

#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>

#include <system_error>

namespace netif {

namespace {

std::string aliasOf(const NET_LUID &luid)
{
    wchar_t alias[NDIS_IF_MAX_STRING_SIZE + 1] = {0};
    if (ConvertInterfaceLuidToAlias(&luid, alias, NDIS_IF_MAX_STRING_SIZE + 1) != NO_ERROR) return std::string();
    int length = WideCharToMultiByte(CP_UTF8, 0, alias, -1, nullptr, 0, nullptr, nullptr);
    if (length <= 1) return std::string();
    std::string converted(static_cast<size_t>(length - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, alias, -1, converted.data(), length, nullptr, nullptr);
    return converted;
}

}

BoundSocket bindToInterface(const std::string &, int, bool, uint16_t, int)
{
    throw std::system_error(ERROR_NOT_SUPPORTED, std::system_category(), "bind to an interface");
}

void membership(int, const std::string &, uint32_t, bool)
{
    throw std::system_error(ERROR_NOT_SUPPORTED, std::system_category(), "membership");
}

std::optional<WeakReception> weakReception(uint32_t index, int family)
{
    PMIB_IPINTERFACE_TABLE table = nullptr;
    DWORD result = GetIpInterfaceTable(family == 6 ? AF_INET6 : AF_INET, &table);
    if (result != NO_ERROR) throw std::system_error(static_cast<int>(result), std::system_category(), "GetIpInterfaceTable");
    std::optional<WeakReception> found;
    for (ULONG position = 0; position < table->NumEntries && !found; position++) {
        const MIB_IPINTERFACE_ROW &row = table->Table[position];
        if (row.InterfaceIndex == index) continue;
        if (row.WeakHostReceive) found = WeakReception{aliasOf(row.InterfaceLuid), "WeakHostReceive"};
        else if (row.ForwardingEnabled) found = WeakReception{aliasOf(row.InterfaceLuid), "Forwarding"};
    }
    FreeMibTable(table);
    return found;
}

}
