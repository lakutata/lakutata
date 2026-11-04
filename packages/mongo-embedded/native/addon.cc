// The functions of the addon: a database opened is an external value (its handle), given to the other functions; each
// call queues a task on the thread of the database and gives the promise of its result.
#include <napi.h>

#include <chrono>
#include <thread>

#include "database.h"

namespace mongo_embedded {
namespace {

Database* DatabaseOf(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsExternal()) throw Napi::TypeError::New(info.Env(), "A database of mongo-embedded is expected");
  return info[0].As<Napi::External<Database>>().Data();
}

Napi::Value Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Database* database = new Database(env, [] {});
  return Napi::External<Database>::New(env, database, [](Napi::Env, Database* database) { delete database; });
}

// A round trip through the thread of the database: the bytes given back, after a delay (ms)
Napi::Value Ping(const Napi::CallbackInfo& info) {
  Database* database = DatabaseOf(info);
  Napi::Buffer<uint8_t> buffer = info[1].As<Napi::Buffer<uint8_t>>();
  std::vector<uint8_t> bytes(buffer.Data(), buffer.Data() + buffer.Length());
  const double delay = info.Length() > 2 && info[2].IsNumber() ? info[2].As<Napi::Number>().DoubleValue() : 0;
  return database->Submit(
      info.Env(),
      [bytes = std::move(bytes), delay](Outcome& outcome) {
        if (delay > 0) std::this_thread::sleep_for(std::chrono::microseconds(static_cast<int64_t>(delay * 1000)));
        outcome.bytes = bytes;
      },
      [](napi_env env, Outcome& outcome) { return BufferOf(env, outcome.bytes.data(), outcome.bytes.size()); });
}

Napi::Value Close(const Napi::CallbackInfo& info) { return DatabaseOf(info)->Close(info.Env()); }

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("open", Napi::Function::New(env, Open, "open"));
  exports.Set("ping", Napi::Function::New(env, Ping, "ping"));
  exports.Set("close", Napi::Function::New(env, Close, "close"));
  return exports;
}

}  // namespace
}  // namespace mongo_embedded

static Napi::Object InitAddon(Napi::Env env, Napi::Object exports) { return mongo_embedded::Init(env, exports); }

NODE_API_MODULE(mongo_embedded, InitAddon)
