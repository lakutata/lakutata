//A netlink socket of the routing family (NETLINK_ROUTE): the dumps of the links and the addresses the interfaces are
//read from, and the socket of the notifications of their changes. Not named Netlink.h: native is an include directory,
//and a file system ignoring case would take that file for <linux/netlink.h>
#pragma once

#include <linux/netlink.h>
#include <linux/rtnetlink.h>

#include <cstdint>
#include <functional>

namespace netif {

class Netlink {
public:
    //A socket for dumps (groups 0), or one joined to the given groups of notifications (RTMGRP_*)
    explicit Netlink(uint32_t groups = 0);

    ~Netlink();

    Netlink(const Netlink &) = delete;

    Netlink &operator=(const Netlink &) = delete;

    int fd() const
    {
        return descriptor;
    }

    //Every message of a dump of the given request type (RTM_GETLINK, RTM_GETADDR), given to the handler
    void dump(uint16_t type, unsigned char family, const std::function<void(const nlmsghdr *)> &handler);

private:
    int descriptor = -1;
    uint32_t sequence = 0;
};

}
