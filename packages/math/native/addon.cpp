//The addon of @lakutata/math: its functions, given to JavaScript by Node-API (through node-addon-api). The operations
//that can take long are jobs: their arguments read in the thread of JavaScript, their work done in it (run) or in the
//pool of the addon (runAsync), their result turned into JavaScript values back in the thread of JavaScript.
#include <napi.h>

#include <cmath>
#include <iterator>
#include <limits>
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
#include "ntheory/NumberTheory.h"
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

//An integer of JavaScript: a bigint, or a number that is a safe integer (-0 is 0)
Integer integerOf(const Napi::Value &value, const std::string &what)
{
    if (value.IsBigInt()) {
        Napi::BigInt big = value.As<Napi::BigInt>();
        int sign = 0;
        size_t count = big.WordCount();
        std::vector<uint64_t> words(std::max<size_t>(count, 1));
        big.ToWords(&sign, &count, words.data());
        //0n has no words (Boost fails on an empty range)
        if (count == 0) return 0;
        //The words of Node-API from the least significant one
        Integer result = 0;
        boost::multiprecision::import_bits(result, words.begin(), words.begin() + count, 64, false);
        return sign ? Integer(-result) : result;
    }
    if (value.IsNumber()) {
        const double number = value.As<Napi::Number>().DoubleValue();
        if (std::isfinite(number) && std::trunc(number) == number && std::fabs(number) <= 9007199254740991.0) return Integer(static_cast<long long>(number));
    }
    throw MathError(ErrorCode::Argument, what + " is not an integer: a bigint, or a number that is a safe integer");
}

Napi::Value bigintValue(Napi::Env env, const Integer &value)
{
    std::vector<uint64_t> words;
    boost::multiprecision::export_bits(value < 0 ? Integer(-value) : value, std::back_inserter(words), 64, false);
    if (words.empty()) words.push_back(0);
    return Napi::BigInt::New(env, value < 0 ? 1 : 0, words.size(), words.data());
}

Napi::Value numberTheoryValue(Napi::Env env, const NumberTheoryResult &result)
{
    using Kind = NumberTheoryResult::Kind;
    switch (result.kind) {
    case Kind::Integer:
        return bigintValue(env, result.integers[0]);
    case Kind::Boolean:
        return Napi::Boolean::New(env, result.flag);
    case Kind::Sign:
        return Napi::Number::New(env, result.sign);
    case Kind::Factors: {
        Napi::Array factors = Napi::Array::New(env, result.integers.size() / 2);
        for (size_t i = 0; i + 1 < result.integers.size(); i += 2) {
            Napi::Object factor = Napi::Object::New(env);
            factor.Set("prime", bigintValue(env, result.integers[i]));
            factor.Set("exponent", Napi::Number::New(env, result.integers[i + 1].convert_to<double>()));
            factors.Set(static_cast<uint32_t>(i / 2), factor);
        }
        return factors;
    }
    case Kind::Rational:
        return wrapExpression(env, result.expression);
    case Kind::Integers: {
        Napi::Array integers = Napi::Array::New(env, result.integers.size());
        for (size_t i = 0; i < result.integers.size(); i++) integers.Set(static_cast<uint32_t>(i), bigintValue(env, result.integers[i]));
        return integers;
    }
    case Kind::Missing:
        break;
    }
    return env.Undefined();
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
    if (digits != std::floor(digits) || digits < 1 || digits > 100000) throw MathError(ErrorCode::Argument, "The number of digits is from 1 to 100000");
    return [expression, digits] {
        std::string text = toDecimal(expression, static_cast<long>(digits));
        return Builder([text](Napi::Env env) { return Napi::String::New(env, text); });
    };
}

//decimalOperation(operation, precision, ...values): an operation of the Decimal class, its values as texts
Job decimalOperationJob(const Napi::Array &arguments)
{
    std::string operation = stringAt(arguments, 0, "The operation");
    const double precision = numberAt(arguments, 1, "The precision");
    if (precision != std::floor(precision) || precision < 1 || precision > 100000) throw MathError(ErrorCode::Argument, "The precision is an integer from 1 to 100000");
    std::vector<std::string> values;
    for (uint32_t i = 2; i < arguments.Length(); i++) values.push_back(stringAt(arguments, i, "A decimal"));
    return [operation, precision, values] {
        std::string text = decimalOperation(operation, static_cast<long>(precision), values);
        return Builder([text](Napi::Env env) { return Napi::String::New(env, text); });
    };
}

Job fractionJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    return [expression] {
        const std::pair<Expr, Expr> fraction = fractionOf(expression);
        return Builder([fraction](Napi::Env env) { return expressionsValue(env, {fraction.first, fraction.second}); });
    };
}

Job coefficientsJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string variable = stringAt(arguments, 1, "The variable");
    return [expression, variable] {
        const std::vector<Expr> coefficients = coefficientsOf(expression, variable);
        return Builder([coefficients](Napi::Env env) { return expressionsValue(env, coefficients); });
    };
}

Job divideJob(const Napi::Array &arguments)
{
    Expr dividend = expressionAt(arguments, 0);
    Expr divisor = expressionAt(arguments, 1);
    std::string variable = stringAt(arguments, 2, "The variable");
    return [dividend, divisor, variable] {
        const std::pair<Expr, Expr> result = divideOf(dividend, divisor, variable);
        return Builder([result](Napi::Env env) { return expressionsValue(env, {result.first, result.second}); });
    };
}

Job rewriteJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string form = stringAt(arguments, 1, "The form");
    return [expression, form] { return expressionResult(rewriteOf(expression, form)); };
}

Job predicateJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string property = stringAt(arguments, 1, "The property");
    return [expression, property] {
        const int answer = predicateOf(expression, property);
        return Builder([answer](Napi::Env env) -> Napi::Value { return answer == -1 ? env.Undefined() : Napi::Boolean::New(env, answer == 1); });
    };
}

Job compareJob(const Napi::Array &arguments)
{
    Expr a = expressionAt(arguments, 0);
    Expr b = expressionAt(arguments, 1);
    return [a, b] {
        const int order = compareOf(a, b);
        return Builder([order](Napi::Env env) -> Napi::Value { return order == 2 ? env.Undefined() : Napi::Number::New(env, order); });
    };
}

Job codeJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string language = stringAt(arguments, 1, "The language");
    if (language != "javascript" && language != "c") throw MathError(ErrorCode::Argument, "The code is written in javascript or c, not " + language);
    return [expression, language] {
        const std::string text = toCode(expression, language == "c");
        return Builder([text](Napi::Env env) { return Napi::String::New(env, text); });
    };
}

Job cseJob(const Napi::Array &arguments)
{
    std::vector<Expr> expressions = expressionsAt(arguments, 0);
    std::string prefix = stringAt(arguments, 1, "The prefix");
    return [expressions, prefix] {
        const CommonSubexpressions result = cseOf(expressions, prefix);
        return Builder([result](Napi::Env env) {
            Napi::Array replacements = Napi::Array::New(env, result.replacements.size());
            for (size_t i = 0; i < result.replacements.size(); i++) {
                Napi::Object replacement = Napi::Object::New(env);
                replacement.Set("name", result.replacements[i].first);
                replacement.Set("value", wrapExpression(env, result.replacements[i].second));
                replacements.Set(static_cast<uint32_t>(i), replacement);
            }
            Napi::Object value = Napi::Object::New(env);
            value.Set("replacements", replacements);
            value.Set("expressions", expressionsValue(env, result.expressions));
            return Napi::Value(value);
        });
    };
}

Job polarJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    return [expression] {
        const std::pair<Expr, Expr> polar = polarOf(expression);
        return Builder([polar](Napi::Env env) { return expressionsValue(env, {polar.first, polar.second}); });
    };
}

Job rectangularJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    return [expression] {
        const std::pair<Expr, Expr> parts = rectangularOf(expression);
        return Builder([parts](Napi::Env env) { return expressionsValue(env, {parts.first, parts.second}); });
    };
}

//An operation of the number theory: its name, then its arguments, integers or arrays of integers
Job numberTheoryJob(const Napi::Array &arguments)
{
    std::string operation = stringAt(arguments, 0, "The operation");
    std::vector<std::vector<Integer>> values;
    for (uint32_t i = 1; i < arguments.Length(); i++) {
        Napi::Value value = arguments.Get(i);
        const std::string what = "Argument " + std::to_string(i) + " of " + operation;
        std::vector<Integer> list;
        if (value.IsArray()) {
            Napi::Array array = value.As<Napi::Array>();
            for (uint32_t j = 0; j < array.Length(); j++) list.push_back(integerOf(array.Get(j), what + ", at index " + std::to_string(j) + ","));
        } else {
            list.push_back(integerOf(value, what));
        }
        values.push_back(std::move(list));
    }
    return [operation, values] {
        NumberTheoryResult result = numberTheoryOf(operation, values);
        return Builder([result](Napi::Env env) { return numberTheoryValue(env, result); });
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
        {"decimal", decimalJob}, {"decimalOperation", decimalOperationJob}, {"arithmetic", arithmeticJob}, {"fraction", fractionJob}, {"coefficients", coefficientsJob},
        {"divide", divideJob}, {"rewrite", rewriteJob}, {"predicate", predicateJob}, {"compare", compareJob},
        {"ntheory", numberTheoryJob}, {"code", codeJob}, {"cse", cseJob}, {"polar", polarJob}, {"rectangular", rectangularJob}
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

//A formula compiled into a function of numbers: by SymEngine's LambdaRealDoubleVisitor, and by its complex one when the
//real one has no value there (a complex value on the way: im(sqrt(y)) for y < 0) or cannot be built (i^i is real):
//the value is then the real part, NaN where it is not real
struct Compiled {
    SymEngine::LambdaRealDoubleVisitor real;
    bool realBuilt = false;
    std::unique_ptr<SymEngine::LambdaComplexDoubleVisitor> complex;
    size_t inputs;

    void call(double *result, const double *values)
    {
        if (realBuilt) {
            real.call(result, values);
            if (!std::isnan(*result) || !complex) return;
        }
        std::vector<std::complex<double>> arguments(values, values + inputs);
        std::complex<double> value;
        complex->call(&value, arguments.data());
        *result = std::abs(value.imag()) <= 1e-12 * std::max(1.0, std::abs(value.real())) ? value.real() : std::numeric_limits<double>::quiet_NaN();
    }
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
        compiled->real.init(variables, *expression);
        compiled->realBuilt = true;
    } catch (SymEngine::SymEngineException &) {
    }
    try {
        auto complex = std::make_unique<SymEngine::LambdaComplexDoubleVisitor>();
        complex->init(variables, *expression);
        compiled->complex = std::move(complex);
    } catch (SymEngine::SymEngineException &) {
    }
    if (!compiled->realBuilt && !compiled->complex) {
        throw MathError(ErrorCode::NotSupported, "The expression cannot be compiled: " + toText(expression) + " has a function without a compiled form");
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
    compiled->call(&result, values);
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
    for (size_t row = 0; row < rows; row++) compiled->call(results.Data() + row, inputs.Data() + row * width);
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
