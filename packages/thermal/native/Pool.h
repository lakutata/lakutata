//The threads of the addon: one pool for the process, which the operations run in (not the threads of libuv, which fs,
//dns and crypto need), and the cancellation of an operation not started yet
#pragma once

#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>

namespace thermal {

class Pool {
public:
    //The pool of the process: LAKUTATA_THERMAL_THREADS threads, else one (each thread loads its own copy of the fonts:
    //FreeType's faces cannot be shared between threads; one thread renders hundreds of receipts a second)
    static Pool &shared();

    //Run a task in a thread of the pool
    void submit(std::function<void()> task);

    //The number of threads of the pool
    unsigned size() const;

private:
    explicit Pool(unsigned size);

    //Start a thread of the pool
    void start();

    void work();

    std::mutex mutex_;
    std::condition_variable available_;
    std::deque<std::function<void()>> tasks_;
    unsigned size_;
};

//The cancellation of an operation: asked by JavaScript (an AbortSignal, a timeout). A rendering running finishes (litehtml
//has no checkpoint), one not started yet is dropped
class Token {
public:
    enum class Reason { None, Cancelled, Timeout };

    void cancel(Reason reason);

    Reason reason() const;

private:
    std::atomic<int> reason_{0};
};

}
