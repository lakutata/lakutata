// The functions of the addon: a database opened is an external value (its handle), given to the other functions; each
// call queues a task on the thread of the database and gives the promise of its result. The arguments are copied on
// the thread of JavaScript; the results are made there by the raw functions of Node-API (database.h).
#include <napi.h>

#include <chrono>
#include <memory>
#include <thread>

#include "connection.h"
#include "database.h"
#include "prefilter.h"

namespace mongo_embedded {
namespace {

// A database: its connection, closed by its thread (stopped first: the thread is destroyed before the connection)
struct Handle {
  std::unique_ptr<Connection> connection;
  std::unique_ptr<Database> database;

  ~Handle() {
    database.reset();
    connection.reset();
  }
};

Handle* HandleOf(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsExternal()) throw Napi::TypeError::New(info.Env(), "A database of mongo-embedded is expected");
  return info[0].As<Napi::External<Handle>>().Data();
}

std::vector<uint8_t> BytesOf(const Napi::Value& value) {
  if (!value.IsBuffer()) throw Napi::TypeError::New(value.Env(), "A Buffer is expected");
  Napi::Buffer<uint8_t> buffer = value.As<Napi::Buffer<uint8_t>>();
  return std::vector<uint8_t>(buffer.Data(), buffer.Data() + buffer.Length());
}

double NumberOf(const Napi::Object& object, const char* name, double fallback) {
  Napi::Value value = object.Get(name);
  return value.IsNumber() ? value.As<Napi::Number>().DoubleValue() : fallback;
}

napi_value Undefined(napi_env env, Outcome&) {
  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  return undefined;
}

// An object of named values made by the raw functions, or nullptr
napi_value ObjectOf(napi_env env, std::initializer_list<std::pair<const char*, napi_value>> fields) {
  napi_value object;
  if (napi_create_object(env, &object) != napi_ok) return nullptr;
  for (const auto& field : fields) {
    if (field.second == nullptr || napi_set_named_property(env, object, field.first, field.second) != napi_ok) return nullptr;
  }
  return object;
}

napi_value BooleanOf(napi_env env, bool value) {
  napi_value result;
  return napi_get_boolean(env, value, &result) == napi_ok ? result : nullptr;
}

napi_value NumberValue(napi_env env, double value) {
  napi_value result;
  return napi_create_double(env, value, &result) == napi_ok ? result : nullptr;
}

void Fail(Outcome& outcome, int code, const std::string& message) {
  outcome.code = code ? code : -1;
  outcome.message = message;
}

// open(directory, {sync, syncInterval, cacheSize, mmapSize}): the handle of the database, once it opened (an empty
// directory for a database in memory)
Napi::Value Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Settings settings;
  settings.directory = info[0].As<Napi::String>().Utf8Value();
  if (info.Length() > 1 && info[1].IsObject()) {
    Napi::Object options = info[1].As<Napi::Object>();
    const std::string sync = options.Get("sync").IsString() ? options.Get("sync").As<Napi::String>().Utf8Value() : "interval";
    settings.sync = sync == "always" ? MDE_SYNC_ALWAYS : sync == "never" ? MDE_SYNC_NEVER : MDE_SYNC_INTERVAL;
    settings.syncInterval = static_cast<int64_t>(NumberOf(options, "syncInterval", 100));
    settings.cacheBytes = static_cast<int64_t>(NumberOf(options, "cacheSize", static_cast<double>(settings.cacheBytes)));
    settings.mmapBytes = static_cast<int64_t>(NumberOf(options, "mmapSize", 0));
  }
  Handle* handle = new Handle();
  handle->connection = std::make_unique<Connection>();
  Connection* connection = handle->connection.get();
  handle->database = std::make_unique<Database>(env, [connection] { connection->Close(); }, [connection] { connection->Idle(); });
  Napi::External<Handle> external = Napi::External<Handle>::New(env, handle, [](Napi::Env, Handle* handle) { delete handle; });
  // The handle held until it is given (or the opening failed)
  napi_ref reference;
  NAPI_THROW_IF_FAILED(env, napi_create_reference(env, external, 1, &reference), Napi::Value());
  return handle->database->Submit(
      env,
      [connection, settings](Outcome& outcome) {
        const std::string message = connection->Open(settings);
        if (!message.empty()) Fail(outcome, -1, message);
      },
      [reference](napi_env env, Outcome&) {
        napi_value value = nullptr;
        if (napi_get_reference_value(env, reference, &value) != napi_ok) value = nullptr;
        napi_delete_reference(env, reference);
        return value;
      });
}

Napi::Value Close(const Napi::CallbackInfo& info) { return HandleOf(info)->database->Close(info.Env()); }

// collections(handle): the collections, each [u32 size of its name][its name][i64 id][i64 count][u32 size of the
// definitions of its indexes][their BSON] (little endian)
Napi::Value Collections(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection](Outcome& outcome) {
        MdeBuffer buffer = {nullptr, 0, 0};
        if (mde_collections(connection->store(), &buffer) != 0) Fail(outcome, -1, mde_message(connection->store()));
        else outcome.bytes.assign(buffer.data, buffer.data + buffer.size);
        mde_buffer_free(&buffer);
      },
      [](napi_env env, Outcome& outcome) { return BufferOf(env, outcome.bytes.data(), outcome.bytes.size()); });
}

// createCollection(handle, name): whether it was created (false when it was there)
Napi::Value CreateCollection(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name](Outcome& outcome) {
        if (connection->IdOf(name)) return;
        std::string message;
        if (!connection->Create(name, &message)) Fail(outcome, -1, message);
        else outcome.done = true;
      },
      [](napi_env env, Outcome& outcome) { return BooleanOf(env, outcome.done); });
}

// setIndexes(handle, name, bson): the definitions of the indexes of a collection written (an empty Buffer: none), the
// collection created when it is missing
Napi::Value SetIndexes(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  auto bytes = std::make_shared<std::vector<uint8_t>>(BytesOf(info[2]));
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name, bytes](Outcome& outcome) {
        std::string message;
        const int64_t id = connection->Create(name, &message);
        if (!id) return Fail(outcome, -1, message);
        if (mde_set_indexes(connection->store(), id, bytes->data(), static_cast<int>(bytes->size())) != 0)
          return Fail(outcome, -1, mde_message(connection->store()));
        connection->Written();
      },
      Undefined);
}

// dropCollection(handle, name): whether it was there
Napi::Value DropCollection(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name](Outcome& outcome) {
        std::string message;
        outcome.done = connection->Drop(name, &message);
        if (!message.empty()) Fail(outcome, -1, message);
      },
      [](napi_env env, Outcome& outcome) { return BooleanOf(env, outcome.done); });
}

// renameCollection(handle, from, to, dropTarget): a collection renamed, the one of the new name dropped when
// dropTarget; rejected with the code of MongoDB (IllegalOperation 20, NamespaceNotFound 26, NamespaceExists 48)
Napi::Value RenameCollection(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string from = info[1].As<Napi::String>().Utf8Value();
  const std::string to = info[2].As<Napi::String>().Utf8Value();
  const bool dropTarget = info.Length() > 3 && info[3].ToBoolean().Value();
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, from, to, dropTarget](Outcome& outcome) {
        std::string message;
        const int code = connection->Rename(from, to, dropTarget, &message);
        if (code != 0) return Fail(outcome, code, message);
        connection->Written();
      },
      Undefined);
}

// dropDatabase(handle): every collection dropped
Napi::Value DropDatabase(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection](Outcome& outcome) {
        const std::map<std::string, int64_t> names = connection->names();
        for (const auto& entry : names) {
          std::string message;
          connection->Drop(entry.first, &message);
          if (!message.empty()) return Fail(outcome, -1, message);
        }
      },
      Undefined);
}

// count(handle, name): the documents of a collection (0 when it is not there)
Napi::Value Count(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name](Outcome& outcome) {
        const int64_t id = connection->IdOf(name);
        int64_t count = 0;
        if (id && mde_count(connection->store(), id, &count) != 0) return Fail(outcome, -1, mde_message(connection->store()));
        outcome.number = static_cast<double>(count);
      },
      [](napi_env env, Outcome& outcome) { return NumberValue(env, outcome.number); });
}

struct Change {
  int kind;
  std::vector<uint8_t> key;
  std::vector<uint8_t> document;
};

struct Entry {
  int change;
  int64_t index;
  bool unique;
  bool remove;
  std::vector<uint8_t> key;
  std::vector<uint8_t> value;
};

// write(handle, name, changes, create, entries, definitions): the changes ([kind, key, BSON]) of a collection and the
// entries of its indexes ([change, index, unique, remove, key, value]) as one transaction, the definitions of its
// indexes written with them when they are given (a Buffer); the collection created when it is missing and create is
// true; rejected with the code, the index of the change failing and the table of the index of a duplicate key
Napi::Value Write(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  Napi::Array given = info[2].As<Napi::Array>();
  const bool create = info.Length() > 3 && info[3].ToBoolean().Value();
  auto changes = std::make_shared<std::vector<Change>>();
  changes->reserve(given.Length());
  for (uint32_t i = 0; i < given.Length(); i++) {
    Napi::Array change = given.Get(i).As<Napi::Array>();
    Change copied;
    copied.kind = change.Get(0u).As<Napi::Number>().Int32Value();
    copied.key = BytesOf(change.Get(1u));
    if (copied.kind != MDE_DELETE) copied.document = BytesOf(change.Get(2u));
    changes->push_back(std::move(copied));
  }
  auto entries = std::make_shared<std::vector<Entry>>();
  if (info.Length() > 4 && info[4].IsArray()) {
    Napi::Array list = info[4].As<Napi::Array>();
    entries->reserve(list.Length());
    for (uint32_t i = 0; i < list.Length(); i++) {
      Napi::Array entry = list.Get(i).As<Napi::Array>();
      entries->push_back({entry.Get(0u).As<Napi::Number>().Int32Value(), entry.Get(1u).As<Napi::Number>().Int64Value(),
                          entry.Get(2u).ToBoolean().Value(), entry.Get(3u).ToBoolean().Value(), BytesOf(entry.Get(4u)),
                          BytesOf(entry.Get(5u))});
    }
  }
  const bool define = info.Length() > 5 && info[5].IsBuffer();
  auto definitions = std::make_shared<std::vector<uint8_t>>();
  if (define) *definitions = BytesOf(info[5]);
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name, changes, create, entries, define, definitions](Outcome& outcome) {
        if (changes->empty() && !define) return;
        int64_t id = connection->IdOf(name);
        if (!id && create) {
          std::string message;
          id = connection->Create(name, &message);
          if (!id) return Fail(outcome, -1, message);
        }
        if (!id) {
          // Nothing to delete in a collection missing; a replacement there fails
          for (size_t i = 0; i < changes->size(); i++) {
            if ((*changes)[i].kind == MDE_DELETE) continue;
            outcome.index = static_cast<int64_t>(i);
            return Fail(outcome, MDE_MISSING, "the document replaced is not there");
          }
          return;
        }
        std::vector<MdeChange> list(changes->size());
        for (size_t i = 0; i < changes->size(); i++) {
          const Change& change = (*changes)[i];
          list[i] = {change.kind, change.key.data(), static_cast<int>(change.key.size()), change.document.data(),
                     static_cast<int>(change.document.size())};
        }
        std::vector<MdeEntry> written(entries->size());
        for (size_t i = 0; i < entries->size(); i++) {
          const Entry& entry = (*entries)[i];
          written[i] = {entry.change, entry.index, entry.unique ? 1 : 0, entry.remove ? 1 : 0, entry.key.data(),
                        static_cast<int>(entry.key.size()), entry.value.data(), static_cast<int>(entry.value.size())};
        }
        int failed = -1;
        int64_t table = -1;
        const int rc = mde_write(connection->store(), id, list.data(), static_cast<int>(list.size()), written.data(),
                                 static_cast<int>(written.size()), define ? definitions->data() : nullptr,
                                 static_cast<int>(definitions->size()), &failed, &table);
        if (rc != 0) {
          outcome.index = failed;
          outcome.table = table;
          return Fail(outcome, rc, mde_message(connection->store()));
        }
        connection->Written();
      },
      Undefined);
}

// get(handle, name, keys): the documents of keys, {bytes: their BSON one after the other, offsets: for each key the
// offset of its document in bytes, -1 when it is not there (i32, little endian)}
Napi::Value Get(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  Napi::Array given = info[2].As<Napi::Array>();
  auto keys = std::make_shared<std::vector<std::vector<uint8_t>>>();
  keys->reserve(given.Length());
  for (uint32_t i = 0; i < given.Length(); i++) keys->push_back(BytesOf(given.Get(i)));
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name, keys](Outcome& outcome) {
        const size_t count = keys->size();
        outcome.offsets.assign(count, -1);
        const int64_t id = connection->IdOf(name);
        if (!id || !count) return;
        std::vector<const uint8_t*> pointers(count);
        std::vector<int> sizes(count);
        for (size_t i = 0; i < count; i++) {
          pointers[i] = (*keys)[i].data();
          sizes[i] = static_cast<int>((*keys)[i].size());
        }
        MdeBuffer buffer = {nullptr, 0, 0};
        if (mde_get(connection->store(), id, pointers.data(), sizes.data(), static_cast<int>(count), &buffer, outcome.offsets.data()) != 0)
          Fail(outcome, -1, mde_message(connection->store()));
        else outcome.bytes.assign(buffer.data, buffer.data + buffer.size);
        mde_buffer_free(&buffer);
      },
      [](napi_env env, Outcome& outcome) {
        return ObjectOf(env, {{"bytes", BufferOf(env, outcome.bytes.data(), outcome.bytes.size())},
                              {"offsets", BufferOf(env, reinterpret_cast<const uint8_t*>(outcome.offsets.data()), outcome.offsets.size() * 4)}});
      });
}

// createIndex(handle, name): the id of the table of a new index of a collection, created when it is missing
Napi::Value CreateIndex(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name](Outcome& outcome) {
        std::string message;
        const int64_t id = connection->Create(name, &message);
        if (!id) return Fail(outcome, -1, message);
        int64_t index = 0;
        if (mde_create_index(connection->store(), id, &index) != 0) return Fail(outcome, -1, mde_message(connection->store()));
        outcome.number = static_cast<double>(index);
        connection->Written();
      },
      [](napi_env env, Outcome& outcome) { return NumberValue(env, outcome.number); });
}

// dropIndex(handle, name, index): the table of an index of a collection dropped
Napi::Value DropIndex(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  const int64_t index = info[2].As<Napi::Number>().Int64Value();
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name, index](Outcome& outcome) {
        const int64_t id = connection->IdOf(name);
        if (id && mde_drop_index(connection->store(), id, index) != 0) return Fail(outcome, -1, mde_message(connection->store()));
        connection->Written();
      },
      Undefined);
}

// writeIndex(handle, name, index, unique, keys, values): entries inserted in the table of an index (a build) as one
// transaction; rejected with the code 11000 and the index of the entry whose key another document holds
Napi::Value WriteIndex(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  const int64_t index = info[2].As<Napi::Number>().Int64Value();
  const bool unique = info[3].ToBoolean().Value();
  Napi::Array keys = info[4].As<Napi::Array>();
  Napi::Array values = info[5].As<Napi::Array>();
  auto entries = std::make_shared<std::vector<std::pair<std::vector<uint8_t>, std::vector<uint8_t>>>>();
  entries->reserve(keys.Length());
  for (uint32_t i = 0; i < keys.Length(); i++) entries->push_back({BytesOf(keys.Get(i)), BytesOf(values.Get(i))});
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name, index, unique, entries](Outcome& outcome) {
        const int64_t id = connection->IdOf(name);
        if (!id || entries->empty()) return;
        const size_t count = entries->size();
        std::vector<const uint8_t*> keyData(count), valueData(count);
        std::vector<int> keySizes(count), valueSizes(count);
        for (size_t i = 0; i < count; i++) {
          keyData[i] = (*entries)[i].first.data();
          keySizes[i] = static_cast<int>((*entries)[i].first.size());
          valueData[i] = (*entries)[i].second.data();
          valueSizes[i] = static_cast<int>((*entries)[i].second.size());
        }
        int failed = -1;
        const int rc = mde_write_index(connection->store(), id, index, unique ? 1 : 0, keyData.data(), keySizes.data(),
                                       valueData.data(), valueSizes.data(), static_cast<int>(count), &failed);
        if (rc != 0) {
          outcome.index = failed;
          outcome.table = failed >= 0 ? index : -1;
          return Fail(outcome, rc, mde_message(connection->store()));
        }
        connection->Written();
      },
      Undefined);
}

// A range of the keys of a table, copied from {lower, lowerInclusive, upper, upperInclusive}
struct Range {
  bool hasLower = false;
  bool lowerInclusive = true;
  std::vector<uint8_t> lower;
  bool hasUpper = false;
  bool upperInclusive = true;
  std::vector<uint8_t> upper;
};

std::shared_ptr<std::vector<Range>> RangesOf(const Napi::Value& value) {
  auto ranges = std::make_shared<std::vector<Range>>();
  if (!value.IsArray()) return ranges;
  Napi::Array given = value.As<Napi::Array>();
  for (uint32_t i = 0; i < given.Length(); i++) {
    Napi::Object object = given.Get(i).As<Napi::Object>();
    Range range;
    range.hasLower = object.Get("lower").IsBuffer();
    if (range.hasLower) range.lower = BytesOf(object.Get("lower"));
    range.lowerInclusive = !object.Get("lowerInclusive").IsBoolean() || object.Get("lowerInclusive").ToBoolean().Value();
    range.hasUpper = object.Get("upper").IsBuffer();
    if (range.hasUpper) range.upper = BytesOf(object.Get("upper"));
    range.upperInclusive = !object.Get("upperInclusive").IsBoolean() || object.Get("upperInclusive").ToBoolean().Value();
    ranges->push_back(std::move(range));
  }
  return ranges;
}

std::vector<MdeRange> NativeRanges(const std::vector<Range>& ranges) {
  std::vector<MdeRange> list(ranges.size());
  for (size_t i = 0; i < ranges.size(); i++) {
    const Range& range = ranges[i];
    list[i] = {range.hasLower ? range.lower.data() : nullptr, static_cast<int>(range.lower.size()), range.lowerInclusive ? 1 : 0,
               range.hasUpper ? range.upper.data() : nullptr, static_cast<int>(range.upper.size()), range.upperInclusive ? 1 : 0};
  }
  return list;
}

// countRange(handle, name, index, ranges): the entries of ranges of a table (an index, or the collection: 0)
Napi::Value CountRange(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  const int64_t index = info[2].As<Napi::Number>().Int64Value();
  auto ranges = RangesOf(info[3]);
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name, index, ranges](Outcome& outcome) {
        const int64_t id = connection->IdOf(name);
        if (!id) return;
        std::vector<MdeRange> list = NativeRanges(*ranges);
        int64_t count = 0;
        if (mde_count_range(connection->store(), id, index, list.data(), static_cast<int>(list.size()), &count) != 0)
          return Fail(outcome, -1, mde_message(connection->store()));
        outcome.number = static_cast<double>(count);
      },
      [](napi_env env, Outcome& outcome) { return NumberValue(env, outcome.number); });
}

// The prefilter of a scan, for the filter of the store
int Accept(const uint8_t* document, size_t size, void* context) {
  return MayMatch(document, size, *static_cast<const std::vector<Predicate>*>(context)) ? 1 : 0;
}

// scan(handle, name, {after, limit, maxBytes, maxScanned, predicates}): the documents after a key in the order of
// their keys, {bytes: their BSON one after the other, last: the key of the last one read (null when none was), done:
// whether the collection was read to its end}; the predicates ([field, comparison, number]) leave out the documents
// failing them (prefilter.h)
Napi::Value Scan(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  Napi::Object options = info.Length() > 2 && info[2].IsObject() ? info[2].As<Napi::Object>() : Napi::Object::New(info.Env());
  auto after = std::make_shared<std::vector<uint8_t>>();
  const bool from = options.Get("after").IsBuffer();
  if (from) *after = BytesOf(options.Get("after"));
  const int limit = static_cast<int>(NumberOf(options, "limit", 1000));
  const size_t maxBytes = static_cast<size_t>(NumberOf(options, "maxBytes", 4 * 1024 * 1024));
  const int maxScanned = static_cast<int>(NumberOf(options, "maxScanned", 10000));
  auto predicates = std::make_shared<std::vector<Predicate>>();
  if (options.Get("predicates").IsArray()) {
    Napi::Array given = options.Get("predicates").As<Napi::Array>();
    for (uint32_t i = 0; i < given.Length(); i++) {
      Napi::Array predicate = given.Get(i).As<Napi::Array>();
      predicates->push_back({predicate.Get(0u).As<Napi::String>().Utf8Value(),
                             static_cast<Comparison>(predicate.Get(1u).As<Napi::Number>().Int32Value()),
                             predicate.Get(2u).As<Napi::Number>().DoubleValue()});
    }
  }
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name, after, from, limit, maxBytes, maxScanned, predicates](Outcome& outcome) {
        outcome.done = true;
        const int64_t id = connection->IdOf(name);
        if (!id) return;
        MdeBuffer documents = {nullptr, 0, 0}, last = {nullptr, 0, 0};
        int done = 1;
        const int rc = mde_scan(connection->store(), id, from ? after->data() : nullptr, static_cast<int>(after->size()), limit, maxBytes,
                                maxScanned, predicates->empty() ? nullptr : Accept, predicates.get(), &documents, &last, &done);
        if (rc != 0) {
          Fail(outcome, rc, mde_message(connection->store()));
        } else {
          outcome.bytes.assign(documents.data, documents.data + documents.size);
          outcome.key.assign(last.data, last.data + last.size);
          outcome.done = done != 0;
          outcome.number = last.data ? 1 : 0;
        }
        mde_buffer_free(&documents);
        mde_buffer_free(&last);
      },
      [](napi_env env, Outcome& outcome) {
        napi_value last = nullptr;
        if (outcome.number) last = BufferOf(env, outcome.key.data(), outcome.key.size());
        else napi_get_null(env, &last);
        return ObjectOf(env, {{"bytes", BufferOf(env, outcome.bytes.data(), outcome.bytes.size())}, {"last", last},
                              {"done", BooleanOf(env, outcome.done)}});
      });
}

// scanRange(handle, name, index, {ranges, reverse, range, after, keysOnly, limit, maxBytes, maxScanned, predicates}): the
// entries of ranges of a table (an index, or the collection: 0) in their order (reversed: the ranges too), from the
// range given, after the key given in it; {bytes: their documents one after the other, left out by the predicates, or
// the keys of their _id ([u32 size][key]) when keysOnly, last: the key of the last entry read (null when none was),
// range: the range it is in, done: whether the ranges were read to their end}
Napi::Value ScanRange(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  const std::string name = info[1].As<Napi::String>().Utf8Value();
  const int64_t index = info[2].As<Napi::Number>().Int64Value();
  Napi::Object options = info.Length() > 3 && info[3].IsObject() ? info[3].As<Napi::Object>() : Napi::Object::New(info.Env());
  auto ranges = RangesOf(options.Get("ranges"));
  const bool reverse = options.Get("reverse").ToBoolean().Value();
  const bool keysOnly = options.Get("keysOnly").ToBoolean().Value();
  const int start = static_cast<int>(NumberOf(options, "range", 0));
  auto after = std::make_shared<std::vector<uint8_t>>();
  const bool from = options.Get("after").IsBuffer();
  if (from) *after = BytesOf(options.Get("after"));
  const int limit = static_cast<int>(NumberOf(options, "limit", 1000));
  const size_t maxBytes = static_cast<size_t>(NumberOf(options, "maxBytes", 4 * 1024 * 1024));
  const int maxScanned = static_cast<int>(NumberOf(options, "maxScanned", 10000));
  auto predicates = std::make_shared<std::vector<Predicate>>();
  if (options.Get("predicates").IsArray()) {
    Napi::Array given = options.Get("predicates").As<Napi::Array>();
    for (uint32_t i = 0; i < given.Length(); i++) {
      Napi::Array predicate = given.Get(i).As<Napi::Array>();
      predicates->push_back({predicate.Get(0u).As<Napi::String>().Utf8Value(),
                             static_cast<Comparison>(predicate.Get(1u).As<Napi::Number>().Int32Value()),
                             predicate.Get(2u).As<Napi::Number>().DoubleValue()});
    }
  }
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection, name, index, ranges, reverse, keysOnly, start, after, from, limit, maxBytes, maxScanned, predicates](Outcome& outcome) {
        outcome.done = true;
        const int64_t id = connection->IdOf(name);
        if (!id) return;
        std::vector<MdeRange> list = NativeRanges(*ranges);
        MdeBuffer documents = {nullptr, 0, 0}, last = {nullptr, 0, 0};
        int done = 1;
        int range = start;
        const int rc = mde_scan_range(connection->store(), id, index, list.data(), static_cast<int>(list.size()), reverse ? 1 : 0,
                                      &range, from ? after->data() : nullptr, static_cast<int>(after->size()), keysOnly ? 1 : 0,
                                      limit, maxBytes, maxScanned, predicates->empty() ? nullptr : Accept, predicates.get(),
                                      &documents, &last, &done);
        if (rc != 0) {
          Fail(outcome, rc, mde_message(connection->store()));
        } else {
          outcome.bytes.assign(documents.data, documents.data + documents.size);
          outcome.key.assign(last.data, last.data + last.size);
          outcome.done = done != 0;
          outcome.index = last.data ? range : -1;
        }
        mde_buffer_free(&documents);
        mde_buffer_free(&last);
      },
      [](napi_env env, Outcome& outcome) {
        napi_value last = nullptr;
        if (outcome.index >= 0) last = BufferOf(env, outcome.key.data(), outcome.key.size());
        else napi_get_null(env, &last);
        return ObjectOf(env, {{"bytes", BufferOf(env, outcome.bytes.data(), outcome.bytes.size())}, {"last", last},
                              {"range", NumberValue(env, static_cast<double>(outcome.index < 0 ? 0 : outcome.index))},
                              {"done", BooleanOf(env, outcome.done)}});
      });
}

// integrity(handle): the result of PRAGMA integrity_check ("ok")
Napi::Value Integrity(const Napi::CallbackInfo& info) {
  Connection* connection = HandleOf(info)->connection.get();
  return HandleOf(info)->database->Submit(
      info.Env(),
      [connection](Outcome& outcome) {
        MdeBuffer buffer = {nullptr, 0, 0};
        if (mde_integrity(connection->store(), &buffer) != 0) Fail(outcome, -1, mde_message(connection->store()));
        else outcome.bytes.assign(buffer.data, buffer.data + buffer.size);
        mde_buffer_free(&buffer);
      },
      [](napi_env env, Outcome& outcome) {
        napi_value text;
        return napi_create_string_utf8(env, reinterpret_cast<const char*>(outcome.bytes.data()), outcome.bytes.size(), &text) == napi_ok ? text : nullptr;
      });
}

// ping(handle, bytes, delay): a round trip through the thread of a database, the bytes given back after a delay (ms)
Napi::Value Ping(const Napi::CallbackInfo& info) {
  Handle* handle = HandleOf(info);
  auto bytes = std::make_shared<std::vector<uint8_t>>(BytesOf(info[1]));
  const double delay = info.Length() > 2 && info[2].IsNumber() ? info[2].As<Napi::Number>().DoubleValue() : 0;
  return handle->database->Submit(
      info.Env(),
      [bytes, delay](Outcome& outcome) {
        if (delay > 0) std::this_thread::sleep_for(std::chrono::microseconds(static_cast<int64_t>(delay * 1000)));
        outcome.bytes = *bytes;
      },
      [](napi_env env, Outcome& outcome) { return BufferOf(env, outcome.bytes.data(), outcome.bytes.size()); });
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("open", Napi::Function::New(env, Open, "open"));
  exports.Set("close", Napi::Function::New(env, Close, "close"));
  exports.Set("collections", Napi::Function::New(env, Collections, "collections"));
  exports.Set("createCollection", Napi::Function::New(env, CreateCollection, "createCollection"));
  exports.Set("setIndexes", Napi::Function::New(env, SetIndexes, "setIndexes"));
  exports.Set("createIndex", Napi::Function::New(env, CreateIndex, "createIndex"));
  exports.Set("dropIndex", Napi::Function::New(env, DropIndex, "dropIndex"));
  exports.Set("writeIndex", Napi::Function::New(env, WriteIndex, "writeIndex"));
  exports.Set("dropCollection", Napi::Function::New(env, DropCollection, "dropCollection"));
  exports.Set("renameCollection", Napi::Function::New(env, RenameCollection, "renameCollection"));
  exports.Set("dropDatabase", Napi::Function::New(env, DropDatabase, "dropDatabase"));
  exports.Set("count", Napi::Function::New(env, Count, "count"));
  exports.Set("write", Napi::Function::New(env, Write, "write"));
  exports.Set("get", Napi::Function::New(env, Get, "get"));
  exports.Set("scan", Napi::Function::New(env, Scan, "scan"));
  exports.Set("scanRange", Napi::Function::New(env, ScanRange, "scanRange"));
  exports.Set("countRange", Napi::Function::New(env, CountRange, "countRange"));
  exports.Set("integrity", Napi::Function::New(env, Integrity, "integrity"));
  exports.Set("ping", Napi::Function::New(env, Ping, "ping"));
  return exports;
}

}  // namespace
}  // namespace mongo_embedded

static Napi::Object InitAddon(Napi::Env env, Napi::Object exports) { return mongo_embedded::Init(env, exports); }

NODE_API_MODULE(mongo_embedded, InitAddon)
