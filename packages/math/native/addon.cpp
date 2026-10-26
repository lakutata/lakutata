//The addon of @lakutata/math: its functions, given to JavaScript by Node-API (through node-addon-api). The operations
//that can take long are jobs: their arguments read in the thread of JavaScript, their work done in it (run) or in the
//pool of the addon (runAsync), their result turned into JavaScript values back in the thread of JavaScript.
#include <napi.h>

#include <map>
#include <mutex>
#include <unordered_map>
#include <Eigen/Core>
#include <symengine/interruption.h>
#include <symengine/lambda_double.h>

#include "async/Pool.h"
#include "core/Errors.h"
#include "core/Handle.h"
#include "core/Scope.h"
#include "ops/Decimal.h"
#include "ops/Operations.h"
#include "parser/Parser.h"
#include "printer/Printer.h"

using namespace math;

namespace {

//What a job gives back: its result as a JavaScript value, made in the thread of JavaScript
using Builder = std::function<Napi::Value(Napi::Env)>;
using Job = std::function<Builder()>;
using JobFactory = Job (*)(const Napi::Array &arguments);

std::string stringAt(const Napi::Array &arguments, uint32_t index, const char *what)
{
    Napi::Value value = arguments.Get(index);
    if (!value.IsString()) throw MathError(ErrorCode::Argument, std::string(what) + " is not a string");
    return value.As<Napi::String>().Utf8Value();
}

double numberAt(const Napi::Array &arguments, uint32_t index, const char *what)
{
    Napi::Value value = arguments.Get(index);
    if (!value.IsNumber()) throw MathError(ErrorCode::Argument, std::string(what) + " is not a number");
    return value.As<Napi::Number>().DoubleValue();
}

Expr expressionAt(const Napi::Array &arguments, uint32_t index)
{
    return unwrapExpression(arguments.Get(index));
}

std::vector<Expr> expressionsAt(const Napi::Array &arguments, uint32_t index)
{
    Napi::Value value = arguments.Get(index);
    if (!value.IsArray()) throw MathError(ErrorCode::Argument, "Not an array of expressions");
    Napi::Array array = value.As<Napi::Array>();
    std::vector<Expr> expressions;
    for (uint32_t i = 0; i < array.Length(); i++) expressions.push_back(unwrapExpression(array.Get(i)));
    return expressions;
}

std::vector<std::string> stringsAt(const Napi::Array &arguments, uint32_t index)
{
    Napi::Value value = arguments.Get(index);
    if (!value.IsArray()) throw MathError(ErrorCode::Argument, "Not an array of names");
    Napi::Array array = value.As<Napi::Array>();
    std::vector<std::string> strings;
    for (uint32_t i = 0; i < array.Length(); i++) strings.push_back(stringAt(array, i, "A name"));
    return strings;
}

Builder expressionResult(const Expr &expression)
{
    return [expression](Napi::Env env) { return wrapExpression(env, expression); };
}

Napi::Value expressionsValue(Napi::Env env, const std::vector<Expr> &expressions)
{
    Napi::Array array = Napi::Array::New(env, expressions.size());
    for (uint32_t i = 0; i < expressions.size(); i++) array.Set(i, wrapExpression(env, expressions[i]));
    return array;
}

Job expandJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    return [expression] { return expressionResult(expandOf(expression)); };
}

Job simplifyJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    return [expression] { return expressionResult(simplifyOf(expression)); };
}

Job diffJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string variable = stringAt(arguments, 1, "The variable");
    const double times = numberAt(arguments, 2, "The number of derivatives");
    if (times < 1 || times > 1000 || times != std::floor(times)) throw MathError(ErrorCode::Argument, "The number of derivatives is an integer from 1 to 1000");
    return [expression, variable, times] { return expressionResult(differentiate(expression, variable, static_cast<unsigned>(times))); };
}

Job substituteJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    Napi::Value pairs = arguments.Get(1);
    if (!pairs.IsArray()) throw MathError(ErrorCode::Argument, "Not an array of values");
    std::vector<std::pair<std::string, Expr>> values;
    Napi::Array array = pairs.As<Napi::Array>();
    for (uint32_t i = 0; i < array.Length(); i++) {
        Napi::Array pair = array.Get(i).As<Napi::Array>();
        values.emplace_back(stringAt(pair, 0, "The variable"), expressionAt(pair, 1));
    }
    return [expression, values] { return expressionResult(substitute(expression, values)); };
}

Job seriesJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string variable = stringAt(arguments, 1, "The variable");
    Expr point = expressionAt(arguments, 2);
    const double order = numberAt(arguments, 3, "The order");
    if (order != std::floor(order)) throw MathError(ErrorCode::Argument, "The order of a series is an integer");
    return [expression, variable, point, order] { return expressionResult(seriesOf(expression, variable, point, static_cast<unsigned>(order))); };
}

Job solveJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string variable = stringAt(arguments, 1, "The variable");
    const bool real = arguments.Get(2).ToBoolean().Value();
    return [expression, variable, real] {
        Solutions solutions = solveOf(expression, variable, real);
        return Builder([solutions](Napi::Env env) -> Napi::Value {
            Napi::Object result = Napi::Object::New(env);
            result.Set("kind", solutions.kind);
            result.Set("values", expressionsValue(env, solutions.values));
            Napi::Array intervals = Napi::Array::New(env, solutions.intervals.size());
            for (uint32_t i = 0; i < solutions.intervals.size(); i++) {
                Napi::Object interval = Napi::Object::New(env);
                interval.Set("start", wrapExpression(env, solutions.intervals[i].start));
                interval.Set("end", wrapExpression(env, solutions.intervals[i].end));
                interval.Set("startOpen", solutions.intervals[i].startOpen);
                interval.Set("endOpen", solutions.intervals[i].endOpen);
                intervals.Set(i, interval);
            }
            result.Set("intervals", intervals);
            if (!solutions.text.empty()) result.Set("text", solutions.text);
            return result;
        });
    };
}

Job solveLinearJob(const Napi::Array &arguments)
{
    std::vector<Expr> equations = expressionsAt(arguments, 0);
    std::vector<std::string> variables = stringsAt(arguments, 1);
    return [equations, variables] {
        LinearSolution solution = solveLinearOf(equations, variables);
        return Builder([solution](Napi::Env env) -> Napi::Value {
            Napi::Object result = Napi::Object::New(env);
            result.Set("kind", solution.kind);
            Napi::Object values = Napi::Object::New(env);
            for (const auto &[name, value] : solution.values) values.Set(name, wrapExpression(env, value));
            result.Set("values", values);
            return result;
        });
    };
}

Job equalsJob(const Napi::Array &arguments)
{
    Expr a = expressionAt(arguments, 0);
    Expr b = expressionAt(arguments, 1);
    return [a, b] {
        const bool equal = equalsOf(a, b);
        return Builder([equal](Napi::Env env) { return Napi::Boolean::New(env, equal); });
    };
}

Job decimalJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    const double digits = numberAt(arguments, 1, "The number of digits");
    if (digits != std::floor(digits)) throw MathError(ErrorCode::Argument, "The number of digits is an integer");
    return [expression, digits] {
        std::string text = toDecimal(expression, static_cast<long>(digits));
        return Builder([text](Napi::Env env) { return Napi::String::New(env, text); });
    };
}

Job arithmeticJob(const Napi::Array &arguments)
{
    const std::string operation = stringAt(arguments, 0, "The operation");
    Expr a = expressionAt(arguments, 1);
    Expr b = expressionAt(arguments, 2);
    return [operation, a, b] { return expressionResult(arithmeticOf(operation, a, b)); };
}

const std::map<std::string, JobFactory> &jobs()
{
    //The tables of the file are never destroyed: the threads of the addon may still use them while the process exits
    static const std::map<std::string, JobFactory> &table = *new std::map<std::string, JobFactory>{
        {"expand", expandJob}, {"simplify", simplifyJob}, {"diff", diffJob}, {"substitute", substituteJob},
        {"series", seriesJob}, {"solve", solveJob}, {"solveLinear", solveLinearJob}, {"equals", equalsJob},
        {"decimal", decimalJob}, {"arithmetic", arithmeticJob}
    };
    return table;
}

Job jobOf(const Napi::CallbackInfo &info)
{
    const std::string name = info[0].As<Napi::String>().Utf8Value();
    const auto factory = jobs().find(name);
    if (factory == jobs().end()) throw MathError(ErrorCode::Argument, "Unknown operation " + name);
    if (!info[1].IsArray()) throw MathError(ErrorCode::Argument, "The arguments of an operation are an array");
    return factory->second(info[1].As<Napi::Array>());
}

//run(operation, arguments): an operation in the thread of JavaScript
Napi::Value Run(const Napi::CallbackInfo &info)
{
    return jobOf(info)()(info.Env());
}

struct Environment;

//The end of an asynchronous operation, back in the thread of JavaScript
struct Completion {
    std::shared_ptr<Environment> environment;
    std::shared_ptr<Token> token;
    Napi::Promise::Deferred deferred;
    Builder builder;
    ErrorInfo error;
    bool failed;
};

void complete(Napi::Env env, Napi::Function, std::nullptr_t *, Completion *completion);

using CompletionFunction = Napi::TypedThreadSafeFunction<std::nullptr_t, Completion, complete>;

//The asynchronous operations of an environment of JavaScript (the main thread, a worker thread). Node frees the
//thread-safe function of an environment torn down (a worker terminated) while the threads of the pool may still call
//it: they call it only while the environment is alive, under the lock its cleanup takes to mark it gone. Its
//operations running are cancelled then, their results dropped.
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
    //No environment: it is being torn down, the promise is gone with it. An environment being torn down may also refuse
    //to settle the promise (a worker terminated): nothing is left to tell then
    if (env != nullptr) {
        try {
            Environment &environment = *completion->environment;
            environment.running.erase(completion);
            if (environment.running.empty()) environment.function.Unref(env);
            if (completion->failed) {
                completion->deferred.Reject(toError(env, completion->error).Value());
            } else {
                try {
                    completion->deferred.Resolve(completion->builder(env));
                } catch (const Napi::Error &error) {
                    completion->deferred.Reject(error.Value());
                } catch (...) {
                    completion->deferred.Reject(currentError(env).Value());
                }
            }
        } catch (...) {
        }
    }
    delete completion;
}

//runAsync(operation, arguments, token?): an operation in the pool of the addon, a promise of its result
Napi::Value RunAsync(const Napi::CallbackInfo &info)
{
    Job job = jobOf(info);
    std::shared_ptr<Token> token = info.Length() > 2 && info[2].IsExternal() ? unwrap<Token>(info[2], TOKEN_TAG, "a token") : std::make_shared<Token>();
    std::shared_ptr<Environment> environment = environmentOf(info.Env());
    auto *completion = new Completion{environment, token, Napi::Promise::Deferred::New(info.Env()), nullptr, {}, false};
    Napi::Promise promise = completion->deferred.Promise();
    if (environment->running.empty()) environment->function.Ref(info.Env());
    environment->running.emplace(completion, token);
    Pool::shared().submit([job, completion]() {
        setCurrentToken(completion->token);
        try {
            checkpoint();
            completion->builder = job();
            checkpoint();
        } catch (...) {
            completion->failed = true;
            completion->error = currentErrorInfo();
        }
        setCurrentToken(nullptr);
        Environment &environment = *completion->environment;
        {
            std::lock_guard<std::mutex> lock(environment.mutex);
            if (environment.alive && environment.function.NonBlockingCall(completion) == napi_ok) return;
        }
        delete completion;
    });
    return promise;
}

Napi::Value Versions(const Napi::CallbackInfo &info)
{
    Napi::Object versions = Napi::Object::New(info.Env());
    versions.Set("symengine", SYMENGINE_VERSION);
    versions.Set("mpdecimal", mpd_version());
    versions.Set("eigen", std::to_string(EIGEN_WORLD_VERSION) + "." + std::to_string(EIGEN_MAJOR_VERSION) + "." + std::to_string(EIGEN_MINOR_VERSION));
    versions.Set("threads", Pool::shared().size());
    return versions;
}

//scope(parent, definitions): a scope of definitions ([signature, body] pairs) over a parent scope or null
Napi::Value MakeScope(const Napi::CallbackInfo &info)
{
    std::shared_ptr<const Scope> parent = info[0].IsExternal() ? unwrap<const Scope>(info[0], SCOPE_TAG, "a scope") : nullptr;
    std::vector<std::pair<std::string, std::string>> definitions;
    Napi::Array array = info[1].As<Napi::Array>();
    for (uint32_t i = 0; i < array.Length(); i++) {
        Napi::Array pair = array.Get(i).As<Napi::Array>();
        definitions.emplace_back(stringAt(pair, 0, "The signature of a definition"), stringAt(pair, 1, "The body of a definition"));
    }
    std::shared_ptr<const Scope> scope = Scope::make(parent, definitions);
    return wrap(info.Env(), scope, SCOPE_TAG, 256 + 256 * static_cast<int64_t>(definitions.size()));
}

//parse(scope, text): {kind: 'expression' | 'equation' | 'relation', left, right?, relation?}
Napi::Value Parse(const Napi::CallbackInfo &info)
{
    std::shared_ptr<const Scope> scope = unwrap<const Scope>(info[0], SCOPE_TAG, "a scope");
    if (!info[1].IsString()) throw MathError(ErrorCode::Argument, "The formula is not a string");
    const std::string text = info[1].As<Napi::String>().Utf8Value();
    Parsed parsed = parse(text, scope->resolver());
    Napi::Object result = Napi::Object::New(info.Env());
    result.Set("kind", parsed.kind == Parsed::Kind::Expression ? "expression" : parsed.kind == Parsed::Kind::Equation ? "equation" : "relation");
    result.Set("left", wrapExpression(info.Env(), parsed.left));
    if (parsed.kind != Parsed::Kind::Expression) {
        result.Set("right", wrapExpression(info.Env(), parsed.right));
        result.Set("relation", parsed.relation);
    }
    return result;
}

Napi::Value Text(const Napi::CallbackInfo &info)
{
    return Napi::String::New(info.Env(), toText(unwrapExpression(info[0])));
}

Napi::Value TeX(const Napi::CallbackInfo &info)
{
    return Napi::String::New(info.Env(), toTeX(unwrapExpression(info[0])));
}

//number(value): the exact value of a number of JavaScript
Napi::Value Number(const Napi::CallbackInfo &info)
{
    if (!info[0].IsNumber()) throw MathError(ErrorCode::Argument, "Not a number");
    return wrapExpression(info.Env(), numberFromDouble(info[0].As<Napi::Number>().DoubleValue()));
}

Napi::Value ToNumber(const Napi::CallbackInfo &info)
{
    return Napi::Number::New(info.Env(), toDouble(unwrapExpression(info[0])));
}

Napi::Value ToComplex(const Napi::CallbackInfo &info)
{
    const std::complex<double> value = toComplex(unwrapExpression(info[0]));
    Napi::Array result = Napi::Array::New(info.Env(), 2);
    result.Set(0u, value.real());
    result.Set(1u, value.imag());
    return result;
}

Napi::Value Variables(const Napi::CallbackInfo &info)
{
    const std::vector<std::string> names = variablesOf(unwrapExpression(info[0]));
    Napi::Array result = Napi::Array::New(info.Env(), names.size());
    for (uint32_t i = 0; i < names.size(); i++) result.Set(i, names[i]);
    return result;
}

//A formula compiled into a function of numbers (SymEngine's LambdaRealDoubleVisitor)
struct Compiled {
    SymEngine::LambdaRealDoubleVisitor visitor;
    size_t inputs;
};

//compile(expression, variables): a compiled function
Napi::Value Compile(const Napi::CallbackInfo &info)
{
    Expr expression = unwrapExpression(info[0]);
    Napi::Array names = info[1].As<Napi::Array>();
    SymEngine::vec_basic variables;
    std::vector<std::string> given;
    for (uint32_t i = 0; i < names.Length(); i++) {
        given.push_back(stringAt(names, i, "A variable"));
        variables.push_back(SymEngine::symbol(given.back()));
    }
    for (const std::string &used : variablesOf(expression)) {
        if (std::find(given.begin(), given.end(), used) == given.end()) throw MathError(ErrorCode::Argument, "The variable " + used + " of the expression is not an input of the function");
    }
    auto compiled = std::make_shared<Compiled>();
    compiled->inputs = variables.size();
    try {
        compiled->visitor.init(variables, *expression);
    } catch (SymEngine::SymEngineException &error) {
        throw MathError(ErrorCode::NotSupported, std::string("The expression cannot be compiled: ") + error.what());
    }
    return wrap(info.Env(), compiled, COMPILED_TAG, 1024);
}

//call(compiled, ...values): the value of a compiled function
Napi::Value Call(const Napi::CallbackInfo &info)
{
    std::shared_ptr<Compiled> compiled = unwrap<Compiled>(info[0], COMPILED_TAG, "a compiled function");
    if (info.Length() - 1 != compiled->inputs) throw MathError(ErrorCode::Argument, "The function takes " + std::to_string(compiled->inputs) + " values");
    double inputs[64];
    std::vector<double> many;
    double *values = inputs;
    if (compiled->inputs > 64) {
        many.resize(compiled->inputs);
        values = many.data();
    }
    for (size_t i = 0; i < compiled->inputs; i++) values[i] = info[i + 1].As<Napi::Number>().DoubleValue();
    double result = 0;
    compiled->visitor.call(&result, values);
    return Napi::Number::New(info.Env(), result);
}

//callBatch(compiled, inputs): the values of a compiled function for rows of inputs (a Float64Array, one row by call)
Napi::Value CallBatch(const Napi::CallbackInfo &info)
{
    std::shared_ptr<Compiled> compiled = unwrap<Compiled>(info[0], COMPILED_TAG, "a compiled function");
    if (!info[1].IsTypedArray() || info[1].As<Napi::TypedArray>().TypedArrayType() != napi_float64_array) throw MathError(ErrorCode::Argument, "The inputs are a Float64Array");
    Napi::Float64Array inputs = info[1].As<Napi::Float64Array>();
    const size_t width = compiled->inputs;
    if (width == 0 ? inputs.ElementLength() != 0 : inputs.ElementLength() % width != 0) throw MathError(ErrorCode::Argument, "The inputs are rows of " + std::to_string(width) + " values");
    const size_t rows = width == 0 ? 1 : inputs.ElementLength() / width;
    Napi::Float64Array results = Napi::Float64Array::New(info.Env(), rows);
    for (size_t row = 0; row < rows; row++) compiled->visitor.call(results.Data() + row, inputs.Data() + row * width);
    return results;
}

//token(): a token of cancellation; cancel(token, reason): cancel the operations given it ('cancelled' or 'timeout')
Napi::Value MakeToken(const Napi::CallbackInfo &info)
{
    return wrap(info.Env(), std::make_shared<Token>(), TOKEN_TAG, 0);
}

Napi::Value Cancel(const Napi::CallbackInfo &info)
{
    std::shared_ptr<Token> token = unwrap<Token>(info[0], TOKEN_TAG, "a token");
    const std::string reason = info[1].IsString() ? info[1].As<Napi::String>().Utf8Value() : "cancelled";
    token->cancel(reason == "timeout" ? Token::Reason::Timeout : Token::Reason::Cancelled);
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    //The checkpoints of SymEngine's long loops are the ones of the addon (set once, before any operation runs)
    static const bool interruptible = (SymEngine::interruption_check = &checkpoint, true);
    (void) interruptible;
    //The asynchronous operations of the environment: its thread-safe function, unreferenced while none runs, and its
    //cleanup (registered after the function, so run before Node closes it)
    auto environment = std::make_shared<Environment>();
    environment->function = CompletionFunction::New(env, "lakutata-math", 0, 1);
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
    exports.Set("versions", Napi::Function::New(env, guarded<Versions>));
    exports.Set("scope", Napi::Function::New(env, guarded<MakeScope>));
    exports.Set("parse", Napi::Function::New(env, guarded<Parse>));
    exports.Set("text", Napi::Function::New(env, guarded<Text>));
    exports.Set("tex", Napi::Function::New(env, guarded<TeX>));
    exports.Set("number", Napi::Function::New(env, guarded<Number>));
    exports.Set("toNumber", Napi::Function::New(env, guarded<ToNumber>));
    exports.Set("toComplex", Napi::Function::New(env, guarded<ToComplex>));
    exports.Set("variables", Napi::Function::New(env, guarded<Variables>));
    exports.Set("compile", Napi::Function::New(env, guarded<Compile>));
    exports.Set("call", Napi::Function::New(env, guarded<Call>));
    exports.Set("callBatch", Napi::Function::New(env, guarded<CallBatch>));
    exports.Set("token", Napi::Function::New(env, guarded<MakeToken>));
    exports.Set("cancel", Napi::Function::New(env, guarded<Cancel>));
    exports.Set("run", Napi::Function::New(env, guarded<Run>));
    exports.Set("runAsync", Napi::Function::New(env, guarded<RunAsync>));
    return exports;
}

}

NODE_API_MODULE(math, Init)
