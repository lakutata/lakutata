//The addon of @lakutata/thermal: the binding of the renderer (litehtml, FreeType, plutovg, lunasvg) to Node-API. The
//arguments are read and checked in the thread of JavaScript, the rendering runs in the pool of the addon, its pages are
//turned into JavaScript values back in the thread of JavaScript.
#include <fstream>
#include <functional>
#include <memory>
#include <mutex>
#include <sstream>
#include <unordered_map>

#include <napi.h>

#include <ft2build.h>
#include FT_FREETYPE_H
#include <lunasvg.h>
#include <plutovg.h>
extern "C" {
#include "unibreakbase.h"
}

#include "Breaks.h"
#include "Errors.h"
#include "Fonts.h"
#include "Pool.h"
#include "Png.h"
#include "Render.h"

namespace thermal {

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
    } catch (const ThermalError &error) {
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
    if (!value.IsTypedArray()) throw ThermalError(ErrorCode::Argument, std::string(what) + " is a Uint8Array");
    Napi::TypedArray array = value.As<Napi::TypedArray>();
    if (array.TypedArrayType() != napi_uint8_array) throw ThermalError(ErrorCode::Argument, std::string(what) + " is a Uint8Array");
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
//run (a running one cannot be stopped: litehtml has no checkpoint)
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
                case Token::Reason::Cancelled: throw ThermalError(ErrorCode::Cancelled, "The operation is cancelled");
                case Token::Reason::Timeout: throw ThermalError(ErrorCode::Timeout, "The operation took longer than its timeout");
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

Napi::Buffer<uint8_t> bufferOf(Napi::Env env, const std::vector<uint8_t> &data)
{
    return Napi::Buffer<uint8_t>::Copy(env, data.data(), data.size());
}

//render(html, options, token?): a promise of the pages, {width, height, rows}
Napi::Value Render(const Napi::CallbackInfo &info)
{
    RenderRequest request;
    if (!info[0].IsString()) throw ThermalError(ErrorCode::Argument, "The HTML is a string");
    request.html = info[0].As<Napi::String>().Utf8Value();
    const Napi::Object options = info[1].As<Napi::Object>();
    request.width = static_cast<int>(numberOf(options, "width", 0));
    request.scale = numberOf(options, "scale", 1);
    request.pageLength = static_cast<int>(numberOf(options, "pageLength", 0));
    request.paginate = booleanOf(options, "paginate", false);
    request.lead = static_cast<int>(numberOf(options, "lead", 0));
    request.rotate = static_cast<int>(numberOf(options, "rotate", 0));
    request.maxLength = static_cast<int>(numberOf(options, "maxLength", 20000));
    request.baseDirectory = stringOf(options, "baseDirectory");
    request.language = stringOf(options, "language", "zh");
    request.userStyles = stringOf(options, "userStyles");
    if (request.scale <= 0 || request.rotate % 90 != 0 || request.rotate < 0 || request.rotate > 270 || request.lead < 0 || request.pageLength < 0)
        throw ThermalError(ErrorCode::Argument, "The options of the rendering are not valid");
    return runAsync(info.Env(), [request = std::move(request)]() -> Builder {
        auto pages = std::make_shared<std::vector<Page>>(render(request));
        return [pages](Napi::Env env) -> Napi::Value {
            Napi::Array array = Napi::Array::New(env, pages->size());
            for (size_t i = 0; i < pages->size(); i++) {
                const Page &page = (*pages)[i];
                Napi::Object value = Napi::Object::New(env);
                value.Set("width", page.width);
                value.Set("height", page.height);
                value.Set("rows", bufferOf(env, page.rows));
                array.Set(static_cast<uint32_t>(i), value);
            }
            return array;
        };
    }, tokenOf(info[2]));
}

//registerFont({family, weight, italic, path | data, index}): the id of the font registered
Napi::Value RegisterFont(const Napi::CallbackInfo &info)
{
    const Napi::Object options = info[0].As<Napi::Object>();
    FontFile file;
    file.family = stringOf(options, "family");
    if (file.family.empty()) throw ThermalError(ErrorCode::Argument, "A font has a family");
    file.weight = static_cast<int>(numberOf(options, "weight", 400));
    file.italic = booleanOf(options, "italic", false);
    file.index = static_cast<long>(numberOf(options, "index", 0));
    const Napi::Value data = options.Get("data");
    if (data.IsTypedArray()) {
        const std::vector<uint8_t> bytes = bytesOf(data, "The data of the font");
        file.data = std::make_shared<const std::string>(bytes.begin(), bytes.end());
    } else {
        const std::string path = stringOf(options, "path");
        std::ifstream stream(path, std::ios::binary);
        if (!stream) throw ThermalError(ErrorCode::Font, "The font file cannot be read: " + path);
        std::stringstream content;
        content << stream.rdbuf();
        file.data = std::make_shared<const std::string>(content.str());
    }
    return Napi::Number::New(info.Env(), static_cast<double>(registerFont(std::move(file))));
}

//png(rows, width, height): the PNG of a page (1-bit grayscale)
Napi::Value Png(const Napi::CallbackInfo &info)
{
    const std::vector<uint8_t> rows = bytesOf(info[0], "The rows");
    const int width = info[1].As<Napi::Number>().Int32Value();
    const int height = info[2].As<Napi::Number>().Int32Value();
    if (width <= 0 || height <= 0 || rows.size() != static_cast<size_t>((width + 7) / 8) * height) throw ThermalError(ErrorCode::Argument, "The rows do not match the size of the page");
    return bufferOf(info.Env(), png(rows.data(), width, height));
}

//words(text, language): the words and the spaces of a text as the line breaking splits it (the tests read it)
Napi::Value Words(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    const std::string text = info[0].As<Napi::String>().Utf8Value();
    const std::string language = info[1].IsString() ? info[1].As<Napi::String>().Utf8Value() : "zh";
    Napi::Array array = Napi::Array::New(env);
    uint32_t index = 0;
    splitText(text.c_str(), language, [&](const std::string &word) { array.Set(index++, word); }, [&](const std::string &space) { array.Set(index++, space); });
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
    if (!info[0].IsExternal()) throw ThermalError(ErrorCode::Argument, "Not a token");
    const std::string reason = info[1].IsString() ? info[1].As<Napi::String>().Utf8Value() : "cancelled";
    tokenOf(info[0])->cancel(reason == "timeout" ? Token::Reason::Timeout : Token::Reason::Cancelled);
    return info.Env().Undefined();
}

//versions(): the versions of the libraries, the threads of the pool
Napi::Value Versions(const Napi::CallbackInfo &info)
{
    Napi::Object versions = Napi::Object::New(info.Env());
    versions.Set("litehtml", "0.10");
    versions.Set("freetype", std::to_string(FREETYPE_MAJOR) + "." + std::to_string(FREETYPE_MINOR) + "." + std::to_string(FREETYPE_PATCH));
    versions.Set("plutovg", plutovg_version_string());
    versions.Set("lunasvg", lunasvg_version_string());
    versions.Set("libunibreak", std::to_string(unibreak_version >> 8) + "." + std::to_string(unibreak_version & 0xFF));
    versions.Set("threads", Pool::shared().size());
    return versions;
}

}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    //The operations of the environment: its thread-safe function, unreferenced while none runs, and its cleanup
    //(registered after the function, so run before Node closes it)
    auto environment = std::make_shared<Environment>();
    environment->function = CompletionFunction::New(env, "lakutata-thermal", 0, 1);
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
    exports.Set("render", Napi::Function::New(env, guarded<Render>));
    exports.Set("registerFont", Napi::Function::New(env, guarded<RegisterFont>));
    exports.Set("png", Napi::Function::New(env, guarded<Png>));
    exports.Set("words", Napi::Function::New(env, guarded<Words>));
    exports.Set("token", Napi::Function::New(env, guarded<MakeToken>));
    exports.Set("cancel", Napi::Function::New(env, guarded<Cancel>));
    exports.Set("versions", Napi::Function::New(env, guarded<Versions>));
    return exports;
}

}

//The registration of the module (NODE_API_MODULE pastes the name of its function into an identifier: no namespace)
static Napi::Object InitThermal(Napi::Env env, Napi::Object exports)
{
    return thermal::Init(env, exports);
}

NODE_API_MODULE(thermal, InitThermal)
