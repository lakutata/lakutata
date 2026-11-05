// The thread of a database: its tasks run one after the other on a thread of its own, their results given back to the
// thread of JavaScript by a thread-safe function, each one resolving or rejecting the promise of its call. The
// thread-safe function holds the event loop only while tasks are pending, so that an open database left idle lets the
// process (or the worker thread) exit; the environment closing stops the thread.
#ifndef MONGO_EMBEDDED_DATABASE_H
#define MONGO_EMBEDDED_DATABASE_H

#include <napi.h>

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace mongo_embedded {

// What a task gives back: a failure (its code and message), or the values its result is made of
struct Outcome {
  // 0, or the code of the failure the promise is rejected with
  int code = 0;
  std::string message;
  std::vector<uint8_t> bytes;
  std::vector<int32_t> offsets;
  std::vector<uint8_t> key;
  double number = 0;
  bool done = false;
  // The index of the change failing a write, given to the error (-1: none)
  int64_t index = -1;
  // The table of the index of a duplicate key failing a write, given to the error (0: the _id; -1: none)
  int64_t table = -1;
};

// The work of a task on the thread of the database, then the value of its result made on the thread of JavaScript by
// the raw functions of Node-API: nullptr when one of them fails (the environment ending), the promise left unsettled.
// The second one is called on a failure too (outcome.code not 0), before the promise is rejected, to release what the
// task holds
using Work = std::function<void(Outcome&)>;
using Finish = std::function<napi_value(napi_env, Outcome&)>;

// A Buffer of a copy of bytes, or nullptr
napi_value BufferOf(napi_env env, const uint8_t* data, size_t size);

// The state the thread-safe function keeps, which outlives the database: the tasks not settled
struct Settling {
  napi_threadsafe_function function = nullptr;
  size_t pending = 0;
};

// A task queued: its promise settled by the raw functions of Node-API, whose failures (the environment ending, where
// JavaScript cannot run) leave it unsettled instead of the fatal errors of node-addon-api
struct Task {
  Work work;
  Finish finish;
  napi_deferred deferred;
  Outcome outcome;
};

class Database {
 public:
  // A database whose store is closed by the function given, on its thread or once it stopped; idle runs on its thread
  // once no task came for kIdleDelay after one (a burst of writes is not held by it)
  Database(Napi::Env env, std::function<void()> closeStore, std::function<void()> idle = nullptr);

  static constexpr std::chrono::milliseconds kIdleDelay{25};
  ~Database();

  // A task queued: the promise of its result (rejected at once when the database is closed)
  Napi::Value Submit(Napi::Env env, Work work, Finish finish);

  // The closing: the tasks queued run, the store is closed, then the thread ends; the promise of its end
  Napi::Value Close(Napi::Env env);

  // The thread stopped at once, after its task running, the tasks queued dropped (the environment ends)
  void Shutdown();

  bool closed() const { return closing_; }

 private:
  void Run();
  static void Settle(Napi::Env env, Napi::Function, Settling* settling, Task* task);
  static void Finalize(Napi::Env, void*, Settling* settling);
  static void Cleanup(void* database);

  using Callback = Napi::TypedThreadSafeFunction<Settling, Task, &Database::Settle>;

  napi_env env_;
  std::function<void()> closeStore_;
  std::function<void()> idle_;
  Settling* settling_;
  Callback settle_;
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable ready_;
  std::deque<Task*> queue_;
  // No more tasks accepted (the thread of JavaScript); the thread to end once its queue is empty
  bool closing_ = false;
  bool ending_ = false;
  bool stopped_ = false;
  // The cleanup hook of the environment ran (it is not to be removed then)
  bool cleaned_ = false;
};

}  // namespace mongo_embedded

#endif
