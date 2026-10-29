//The notifications of the changes of the interfaces (links, addresses, their settings), from a thread of the addon or
//of the system: each one calls the function given, which only signals that something changed (JavaScript reads the
//interfaces again). Stopped when destroyed: no call once the destructor has returned. Each system has its own source
//file (linux/, darwin/, windows/).
#pragma once

#include <functional>
#include <memory>

namespace netif {

class Watcher {
public:
    explicit Watcher(std::function<void()> changed);

    ~Watcher();

    Watcher(const Watcher &) = delete;

    Watcher &operator=(const Watcher &) = delete;

private:
    struct State;
    std::unique_ptr<State> state;
};

}
