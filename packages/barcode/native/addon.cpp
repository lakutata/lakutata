//The addon of @lakutata/barcode: the binding of zint (generation) and zxing-cpp (reading) to Node-API. The arguments are
//read and checked in the thread of JavaScript, the work runs in the pool of the addon, its result is turned into
//JavaScript values back in the thread of JavaScript.
#include <functional>
#include <memory>
#include <mutex>
#include <unordered_map>

#include <napi.h>

#include "Errors.h"
#include "Formats.h"
#include "Generate.h"
#include "Pool.h"
#include "Read.h"
#include "Version.h"
#include "codecs/WuffsConfig.h"
#include "wuffs-v0.4.c"
#include "zint.h"

namespace barcode {

namespace {

//The JavaScript value of a result, made in the thread of JavaScript
using Builder = std::function<Napi::Value(Napi::Env)>;
//The work of an operation, run in a thread of the pool
using Job = std::function<Builder()>;

//The error of a code: a JavaScript Error with the code, which the TypeScript side turns into its exception
Napi::Error errorOf(Napi::Env env, ErrorCode code, const std::string &message)
{
    Napi::Error error = Napi::Error::New(env, message);
    error.Set("code", Napi::String::New(env, errorCodeName(code)));
    return error;
}

//The code and the message of the exception being handled
std::pair<ErrorCode, std::string> currentError()
{
    try {
        throw;
    } catch (const BarcodeError &error) {
        return {error.code(), error.what()};
    } catch (const std::bad_alloc &) {
        return {ErrorCode::Internal, "Out of memory"};
    } catch (const std::exception &error) {
        return {ErrorCode::Internal, error.what()};
    } catch (...) {
        return {ErrorCode::Internal, "An unknown error"};
    }
}

//A function of the addon: every C++ exception becomes a JavaScript one
template <Napi::Value (*Function)(const Napi::CallbackInfo &)>
Napi::Value guarded(const Napi::CallbackInfo &info)
{
    try {
        return Function(info);
    } catch (const Napi::Error &) {
        throw;
    } catch (...) {
        const auto [code, message] = currentError();
        throw errorOf(info.Env(), code, message);
    }
}

std::vector<uint8_t> bytesOf(const Napi::Value &value, const char *what)
{
    if (!value.IsTypedArray()) throw BarcodeError(ErrorCode::Argument, std::string(what) + " is a Uint8Array");
    Napi::TypedArray array = value.As<Napi::TypedArray>();
    if (array.TypedArrayType() != napi_uint8_array) throw BarcodeError(ErrorCode::Argument, std::string(what) + " is a Uint8Array");
    Napi::Uint8Array bytes = array.As<Napi::Uint8Array>();
    return std::vector<uint8_t>(bytes.Data(), bytes.Data() + bytes.ElementLength());
}

std::string stringOf(const Napi::Object &options, const char *key, const std::string &otherwise = "")
{
    const Napi::Value value = options.Get(key);
    return value.IsString() ? value.As<Napi::String>().Utf8Value() : otherwise;
}

double numberOf(const Napi::Object &options, const char *key, double otherwise)
{
    const Napi::Value value = options.Get(key);
    return value.IsNumber() ? value.As<Napi::Number>().DoubleValue() : otherwise;
}

bool booleanOf(const Napi::Object &options, const char *key, bool otherwise)
{
    const Napi::Value value = options.Get(key);
    return value.IsBoolean() ? value.As<Napi::Boolean>().Value() : otherwise;
}

//The token of an operation, given by the TypeScript side (a cancellation), wrapped in an External
std::shared_ptr<Token> tokenOf(const Napi::Value &value)
{
    if (!value.IsExternal()) return std::make_shared<Token>();
    auto *token = value.As<Napi::External<std::shared_ptr<Token>>>().Data();
    return *token;
}

struct Environment;

//The end of an operation, back in the thread of JavaScript
struct Completion {
    std::shared_ptr<Environment> environment;
    std::shared_ptr<Token> token;
    Napi::Promise::Deferred deferred;
    Builder builder;
    ErrorCode errorCode = ErrorCode::Internal;
    std::string errorMessage;
    bool failed = false;
};

void complete(Napi::Env env, Napi::Function, std::nullptr_t *, Completion *completion);

using CompletionFunction = Napi::TypedThreadSafeFunction<std::nullptr_t, Completion, complete>;

//The operations of an environment of JavaScript (the main thread, a worker thread). Node frees the thread-safe function
//of an environment torn down (a worker terminated) while the threads of the pool may still call it: they call it only
//while the environment is alive, under the lock its cleanup takes to mark it gone
struct Environment {
    std::mutex mutex;
    bool alive = true;
    CompletionFunction function;
    //Only in the thread of JavaScript: the operations running (the loop of events is kept alive while there are some)
    std::unordered_map<Completion *, std::shared_ptr<Token>> running;
};

std::shared_ptr<Environment> environmentOf(Napi::Env env)
{
    return *env.GetInstanceData<std::shared_ptr<Environment>>();
}

void complete(Napi::Env env, Napi::Function, std::nullptr_t *, Completion *completion)
{
    //No environment: it is being torn down, the promise is gone with it
    bool alive = false;
    if (env != nullptr) {
        std::lock_guard<std::mutex> lock(completion->environment->mutex);
        alive = completion->environment->alive;
    }
    if (alive) {
        try {
            Environment &environment = *completion->environment;
            environment.running.erase(completion);
            if (environment.running.empty()) environment.function.Unref(env);
            if (completion->failed) {
                completion->deferred.Reject(errorOf(env, completion->errorCode, completion->errorMessage).Value());
            } else {
                try {
                    completion->deferred.Resolve(completion->builder(env));
                } catch (const Napi::Error &error) {
                    completion->deferred.Reject(error.Value());
                } catch (...) {
                    const auto [code, message] = currentError();
                    completion->deferred.Reject(errorOf(env, code, message).Value());
                }
            }
        } catch (...) {
        }
    }
    delete completion;
}

//Run a job in the pool of the addon: a promise of its result. A job whose token is cancelled before it starts is not
//run (a running one cannot be stopped: zint and zxing-cpp have no checkpoint)
Napi::Value runAsync(Napi::Env env, Job job, std::shared_ptr<Token> token)
{
    std::shared_ptr<Environment> environment = environmentOf(env);
    auto *completion = new Completion{environment, token, Napi::Promise::Deferred::New(env), nullptr, ErrorCode::Internal, "", false};
    Napi::Promise promise = completion->deferred.Promise();
    if (environment->running.empty()) environment->function.Ref(env);
    environment->running.emplace(completion, token);
    Pool::shared().submit([job = std::move(job), completion]() {
        try {
            switch (completion->token->reason()) {
                case Token::Reason::Cancelled: throw BarcodeError(ErrorCode::Cancelled, "The operation is cancelled");
                case Token::Reason::Timeout: throw BarcodeError(ErrorCode::Timeout, "The operation took longer than its timeout");
                case Token::Reason::None: break;
            }
            completion->builder = job();
        } catch (...) {
            completion->failed = true;
            std::tie(completion->errorCode, completion->errorMessage) = currentError();
        }
        Environment &environment = *completion->environment;
        {
            std::lock_guard<std::mutex> lock(environment.mutex);
            if (environment.alive && environment.function.NonBlockingCall(completion) == napi_ok) return;
        }
        delete completion;
    });
    return promise;
}

Napi::Buffer<uint8_t> bufferOf(Napi::Env env, std::vector<uint8_t> &&data)
{
    return Napi::Buffer<uint8_t>::Copy(env, data.data(), data.size());
}

//generate(format, content, binary, options, token?): a promise of {type, data, width, height, channels}
Napi::Value Generate(const Napi::CallbackInfo &info)
{
    GenerateRequest request;
    const std::string name = info[0].As<Napi::String>().Utf8Value();
    request.format = formatOf(name);
    if (!request.format) throw BarcodeError(ErrorCode::Argument, "Unknown format " + name);
    request.content = bytesOf(info[1], "The content");
    request.binary = info[2].As<Napi::Boolean>().Value();
    const Napi::Object options = info[3].As<Napi::Object>();
    request.output = stringOf(options, "output", "png");
    request.scale = numberOf(options, "scale", 4);
    request.height = numberOf(options, "height", 0);
    const Napi::Value quietZone = options.Get("quietZone");
    request.quietZone = quietZone.IsNumber() ? quietZone.As<Napi::Number>().Int32Value() : quietZone.IsBoolean() && !quietZone.As<Napi::Boolean>().Value() ? 0 : -1;
    request.showText = booleanOf(options, "showText", true);
    request.foreground = stringOf(options, "foreground");
    request.background = stringOf(options, "background");
    request.rotate = static_cast<int>(numberOf(options, "rotate", 0));
    const Napi::Value errorCorrection = options.Get("errorCorrection");
    if (errorCorrection.IsString()) request.errorLetter = errorCorrection.As<Napi::String>().Utf8Value();
    else if (errorCorrection.IsNumber()) request.errorLevel = errorCorrection.As<Napi::Number>().Int32Value();
    request.version = static_cast<int>(numberOf(options, "version", 0));
    request.gs1 = booleanOf(options, "gs1", false);
    request.eci = static_cast<int>(numberOf(options, "eci", 0));
    request.addOn = stringOf(options, "addOn");
    checkGenerateRequest(request);
    return runAsync(info.Env(), [request = std::move(request)]() -> Builder {
        auto result = std::make_shared<GenerateResult>(generate(request));
        return [result](Napi::Env env) -> Napi::Value {
            Napi::Object value = Napi::Object::New(env);
            value.Set("type", result->type);
            value.Set("data", bufferOf(env, std::move(result->data)));
            value.Set("width", result->width);
            value.Set("height", result->height);
            value.Set("channels", result->channels);
            return value;
        };
    }, tokenOf(info[4]));
}

//read(image, raw, options, token?): a promise of the barcodes read. raw: {width, height, channels} for pixels, null
//for an encoded image
Napi::Value Read(const Napi::CallbackInfo &info)
{
    ReadRequest request;
    request.image = bytesOf(info[0], "The image");
    if (info[1].IsObject()) {
        const Napi::Object raw = info[1].As<Napi::Object>();
        request.raw = true;
        request.width = static_cast<int>(numberOf(raw, "width", 0));
        request.height = static_cast<int>(numberOf(raw, "height", 0));
        request.channels = static_cast<int>(numberOf(raw, "channels", 0));
        if (request.width <= 0 || request.height <= 0 || (request.channels != 1 && request.channels != 3 && request.channels != 4)) throw BarcodeError(ErrorCode::Image, "The pixels have a width, a height and 1, 3 or 4 channels");
        if (request.image.size() != static_cast<size_t>(request.width) * request.height * request.channels) throw BarcodeError(ErrorCode::Image, "The pixels are " + std::to_string(request.width) + " × " + std::to_string(request.height) + " × " + std::to_string(request.channels) + " bytes, " + std::to_string(request.image.size()) + " given");
    }
    const Napi::Object options = info[2].As<Napi::Object>();
    const Napi::Value formats = options.Get("formats");
    if (formats.IsArray()) {
        std::vector<std::string> names;
        const Napi::Array array = formats.As<Napi::Array>();
        for (uint32_t i = 0; i < array.Length(); i++) names.push_back(array.Get(i).As<Napi::String>().Utf8Value());
        request.options.setFormats(readFormatsOf(names));
    }
    request.options.setTryHarder(booleanOf(options, "tryHarder", true));
    request.options.setTryRotate(booleanOf(options, "tryRotate", true));
    request.options.setTryInvert(booleanOf(options, "tryInvert", true));
    request.options.setTryDownscale(booleanOf(options, "tryDownscale", true));
    request.options.setIsPure(booleanOf(options, "pure", false));
    request.options.setMaxNumberOfSymbols(static_cast<uint8_t>(numberOf(options, "maxSymbols", 255)));
    const std::string addOn = stringOf(options, "addOn", "read");
    request.options.setEanAddOnSymbol(addOn == "ignore" ? ZXing::EanAddOnSymbol::Ignore : addOn == "require" ? ZXing::EanAddOnSymbol::Require : ZXing::EanAddOnSymbol::Read);
    //GS1 data as (01)…, the other contents as text
    request.options.setTextMode(ZXing::TextMode::HRI);
    request.options.setReturnErrors(false);
    return runAsync(info.Env(), [request = std::move(request)]() -> Builder {
        auto results = std::make_shared<std::vector<ReadResult>>(read(request));
        return [results](Napi::Env env) -> Napi::Value {
            Napi::Array array = Napi::Array::New(env, results->size());
            for (size_t i = 0; i < results->size(); i++) {
                ReadResult &result = (*results)[i];
                Napi::Object value = Napi::Object::New(env);
                value.Set("format", result.format);
                value.Set("text", result.text);
                value.Set("bytes", bufferOf(env, std::move(result.bytes)));
                Napi::Array position = Napi::Array::New(env, 8);
                for (uint32_t j = 0; j < 8; j++) position.Set(j, result.position[j]);
                value.Set("position", position);
                value.Set("orientation", result.orientation);
                value.Set("errorCorrectionLevel", result.errorCorrectionLevel);
                value.Set("version", result.version);
                value.Set("symbologyIdentifier", result.symbologyIdentifier);
                value.Set("addOn", result.addOn);
                value.Set("gs1", result.gs1);
                value.Set("mirrored", result.mirrored);
                value.Set("inverted", result.inverted);
                value.Set("sequenceIndex", result.sequenceIndex);
                value.Set("sequenceSize", result.sequenceSize);
                value.Set("sequenceId", result.sequenceId);
                array.Set(static_cast<uint32_t>(i), value);
            }
            return array;
        };
    }, tokenOf(info[3]));
}

//formats(): the formats and their options (the table of Formats.cpp, the capabilities of zint)
Napi::Value Formats(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    const std::vector<Format> &table = formats();
    Napi::Array array = Napi::Array::New(env, table.size());
    for (size_t i = 0; i < table.size(); i++) {
        const Format &format = table[i];
        Napi::Object value = Napi::Object::New(env);
        value.Set("name", format.name);
        value.Set("errorCorrection", format.errorCorrection == ErrorCorrection::Letters ? Napi::Value(Napi::String::New(env, format.letters)) : format.errorCorrection == ErrorCorrection::Level ? Napi::Value(Napi::String::New(env, std::to_string(format.levelFrom) + "-" + std::to_string(format.levelTo))) : env.Null());
        value.Set("versions", format.versions);
        value.Set("reads", format.readsAs ? format.readsAs : format.name);
        value.Set("gs1", format.gs1Symbology != 0 || ZBarcode_Cap(format.symbology, ZINT_CAP_GS1) != 0);
        value.Set("eci", ZBarcode_Cap(format.symbology, ZINT_CAP_ECI) != 0);
        value.Set("addOn", ZBarcode_Cap(format.symbology, ZINT_CAP_EANUPC) != 0);
        value.Set("text", ZBarcode_Cap(format.symbology, ZINT_CAP_HRT) != 0);
        array.Set(static_cast<uint32_t>(i), value);
    }
    return array;
}

//token(): a token of cancellation; cancel(token, reason): cancel the operation given it, if not started yet
Napi::Value MakeToken(const Napi::CallbackInfo &info)
{
    return Napi::External<std::shared_ptr<Token>>::New(info.Env(), new std::shared_ptr<Token>(std::make_shared<Token>()), [](Napi::Env, std::shared_ptr<Token> *token) {
        delete token;
    });
}

Napi::Value Cancel(const Napi::CallbackInfo &info)
{
    if (!info[0].IsExternal()) throw BarcodeError(ErrorCode::Argument, "Not a token");
    const std::string reason = info[1].IsString() ? info[1].As<Napi::String>().Utf8Value() : "cancelled";
    tokenOf(info[0])->cancel(reason == "timeout" ? Token::Reason::Timeout : Token::Reason::Cancelled);
    return info.Env().Undefined();
}

//versions(): the versions of the libraries, the threads of the pool
Napi::Value Versions(const Napi::CallbackInfo &info)
{
    Napi::Object versions = Napi::Object::New(info.Env());
    const int zint = ZBarcode_Version();
    versions.Set("zint", std::to_string(zint / 10000) + "." + std::to_string(zint / 100 % 100) + "." + std::to_string(zint % 100));
    versions.Set("zxing", ZXING_VERSION_STR);
    versions.Set("wuffs", WUFFS_VERSION_STRING);
    versions.Set("threads", Pool::shared().size());
    return versions;
}

}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    //The operations of the environment: its thread-safe function, unreferenced while none runs, and its cleanup
    //(registered after the function, so run before Node closes it)
    auto environment = std::make_shared<Environment>();
    environment->function = CompletionFunction::New(env, "lakutata-barcode", 0, 1);
    environment->function.Unref(env);
    env.SetInstanceData(new std::shared_ptr<Environment>(environment));
    env.AddCleanupHook([environment]() {
        {
            std::lock_guard<std::mutex> lock(environment->mutex);
            environment->alive = false;
        }
        for (const auto &[completion, token] : environment->running) token->cancel(Token::Reason::Cancelled);
        environment->running.clear();
    });
    exports.Set("generate", Napi::Function::New(env, guarded<Generate>));
    exports.Set("read", Napi::Function::New(env, guarded<Read>));
    exports.Set("formats", Napi::Function::New(env, guarded<Formats>));
    exports.Set("token", Napi::Function::New(env, guarded<MakeToken>));
    exports.Set("cancel", Napi::Function::New(env, guarded<Cancel>));
    exports.Set("versions", Napi::Function::New(env, guarded<Versions>));
    return exports;
}

}

//The registration of the module (NODE_API_MODULE pastes the name of its function into an identifier: no namespace)
static Napi::Object InitBarcode(Napi::Env env, Napi::Object exports)
{
    return barcode::Init(env, exports);
}

NODE_API_MODULE(barcode, InitBarcode)
