//The threads of the addon: one pool for the process, which the asynchronous operations run in (not the threads of
//libuv, which fs, dns and crypto need), and the cancellation of an operation
#pragma once

#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>

namespace math {

class Pool {
public:
    //The pool of the process: LAKUTATA_MATH_THREADS threads, else the processors less one (one at least)
    static Pool &shared();

    //Run a task in a thread of the pool
    void submit(std::function<void()> task);

    //The number of threads of the pool
    unsigned size() const;

private:
    explicit Pool(unsigned size);

    //Start a thread of the pool, its stack deep enough for the expressions (128 KiB by default with musl)
    void start();

    void work();

    std::mutex mutex_;
    std::condition_variable available_;
    std::deque<std::function<void()>> tasks_;
    unsigned size_;
};

//The cancellation of an operation: asked by JavaScript (an AbortSignal, a timeout), seen by the algorithms of the
//addon at their checkpoints
class Token {
public:
    enum class Reason { None, Cancelled, Timeout };

    void cancel(Reason reason);

    Reason reason() const;

private:
    std::atomic<int> reason_{0};
};

//The token of the operation running in this thread, none outside of an asynchronous operation
void setCurrentToken(std::shared_ptr<Token> token);

//A checkpoint: throws MathError (Cancelled, Timeout) when the operation running in this thread is cancelled
void checkpoint();

}
