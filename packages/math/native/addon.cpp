//The addon of @lakutata/math: its functions, given to JavaScript by Node-API (through node-addon-api). The operations
//that can take long are jobs: their arguments read in the thread of JavaScript, their work done in it (run) or in the
//pool of the addon (runAsync), their result turned into JavaScript values back in the thread of JavaScript.
#include <napi.h>

#include <cmath>
#include <cstdint>
#include <cstring>
#include <optional>
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
#include "linalg/Linalg.h"
#include "matrix/Matrices.h"
#include "integrals/Integrals.h"
#include "limits/Gruntz.h"
#include "poly/Inequalities.h"
#include "poly/Poly.h"
#include "numeric/Compiled.h"
#include "numeric/Numeric.h"
#include "stats/Distributions.h"
#include "stats/Statistics.h"
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

//Whether the job being made copies the data of its arguments: an asynchronous operation reads them in another thread,
//after its call has returned (a synchronous one reads them in place). Set by RunAsync around the making of its job
thread_local bool copyingArguments = false;

class CopyingArguments {
public:
    CopyingArguments()
    {
        copyingArguments = true;
    }

    ~CopyingArguments()
    {
        copyingArguments = false;
    }
};

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

//Solutions as an object: their kind, their values, their intervals, the text of a set not solved
Builder solutionsBuilder(const Solutions &solutions)
{
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
}

Job solveJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string variable = stringAt(arguments, 1, "The variable");
    const bool real = arguments.Get(2).ToBoolean().Value();
    return [expression, variable, real] {
        return solutionsBuilder(solveOf(expression, variable, real));
    };
}

//An antiderivative of an expression in a variable, or its definite integral between two values
Job integralJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string variable = stringAt(arguments, 1, "The variable");
    if (arguments.Length() < 4) return [expression, variable] { return expressionResult(antiderivativeOf(expression, variable)); };
    Expr from = expressionAt(arguments, 2), to = expressionAt(arguments, 3);
    return [expression, variable, from, to] { return expressionResult(definiteIntegralOf(expression, variable, from, to)); };
}

//The Laplace transform of an expression (its variable, the variable of the transform), or its inverse
Job laplaceJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string from = stringAt(arguments, 1, "The variable"), to = stringAt(arguments, 2, "The variable of the transform");
    const bool inverse = arguments.Length() > 3 && arguments.Get(3u).ToBoolean().Value();
    return [expression, from, to, inverse] { return expressionResult(inverse ? inverseLaplaceOf(expression, from, to) : laplaceOf(expression, from, to)); };
}

//The limit of an expression for a variable going to a point, from a direction
Job limitJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string variable = stringAt(arguments, 1, "The variable");
    Expr point = expressionAt(arguments, 2);
    std::string direction = stringAt(arguments, 3, "The direction");
    return [expression, variable, point, direction] { return expressionResult(limitOf(expression, variable, point, direction)); };
}

//expression < 0 (or <=, >, >=) solved for a variable in the real numbers
Job inequalityJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    std::string relation = stringAt(arguments, 1, "The relation");
    std::string variable = stringAt(arguments, 2, "The variable");
    return [expression, relation, variable] {
        return solutionsBuilder(inequalityOf(expression, relation, variable));
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

Job complexDecimalJob(const Napi::Array &arguments)
{
    Expr expression = expressionAt(arguments, 0);
    const double digits = numberAt(arguments, 1, "The number of digits");
    if (digits != std::floor(digits) || digits < 1 || digits > 100000) throw MathError(ErrorCode::Argument, "The number of digits is from 1 to 100000");
    return [expression, digits] {
        const std::pair<std::string, std::string> parts = toComplexDecimal(expression, static_cast<long>(digits));
        return Builder([parts](Napi::Env env) {
            Napi::Array result = Napi::Array::New(env, 2);
            result.Set(0u, Napi::String::New(env, parts.first));
            result.Set(1u, Napi::String::New(env, parts.second));
            return result;
        });
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

//Whether the elements of a typed array are aligned for their type: V8 with pointer compression (Electron) may keep the
//elements of a small typed array in its heap 4-byte aligned, where Eigen's maps assert ("data is not scalar-aligned")
//and reads of their type are not defined
template <typename T>
bool aligned(const T *data)
{
    return reinterpret_cast<std::uintptr_t>(data) % alignof(T) == 0;
}

//The elements of a typed array, copied by their bytes (aligned or not)
template <typename T>
std::vector<T> elementsOf(const Napi::TypedArrayOf<T> &array)
{
    std::vector<T> elements(array.ElementLength());
    if (!elements.empty()) std::memcpy(elements.data(), array.Data(), elements.size() * sizeof(T));
    return elements;
}

//A matrix given as [rows, columns, Float64Array] (its elements row-major)
MatrixArgument matrixArgumentOf(const Napi::Value &value)
{
    if (!value.IsArray()) throw MathError(ErrorCode::Argument, "A matrix is given as [rows, columns, Float64Array]");
    const Napi::Array parts = value.As<Napi::Array>();
    const Napi::Value rows = parts.Get(0u), columns = parts.Get(1u), data = parts.Get(2u);
    auto dimension = [](const Napi::Value &number) {
        if (!number.IsNumber()) throw MathError(ErrorCode::Argument, "A dimension of a matrix is not a number");
        const double size = number.As<Napi::Number>().DoubleValue();
        if (size != std::floor(size) || size < 0 || size > 4294967295.0) throw MathError(ErrorCode::Argument, "A dimension of a matrix is not an integer of 0 or more");
        return static_cast<size_t>(size);
    };
    MatrixArgument matrix;
    matrix.rows = dimension(rows);
    matrix.columns = dimension(columns);
    if (!data.IsTypedArray() || data.As<Napi::TypedArray>().TypedArrayType() != napi_float64_array) throw MathError(ErrorCode::Argument, "The elements of a matrix are not a Float64Array");
    const Napi::Float64Array elements = data.As<Napi::Float64Array>();
    if (static_cast<double>(elements.ElementLength()) != static_cast<double>(matrix.rows) * static_cast<double>(matrix.columns)) {
        throw MathError(ErrorCode::Argument, "A matrix of " + std::to_string(matrix.rows) + "×" + std::to_string(matrix.columns) + " has " + std::to_string(elements.ElementLength()) + " elements");
    }
    if (copyingArguments || !aligned(elements.Data())) {
        matrix.owned = std::make_shared<const std::vector<double>>(elementsOf(elements));
        matrix.values = matrix.owned->data();
    } else {
        matrix.values = elements.Data();
    }
    return matrix;
}

//linalg(operation, matrices, numbers?, option?): an operation of the linear algebra; its results as [rows, columns,
//Float64Array]
Job linalgJob(const Napi::Array &arguments)
{
    std::string operation = stringAt(arguments, 0, "The operation");
    const Napi::Value list = arguments.Get(1u);
    if (!list.IsArray()) throw MathError(ErrorCode::Argument, "The matrices of an operation are an array");
    std::vector<MatrixArgument> matrices;
    const Napi::Array given = list.As<Napi::Array>();
    for (uint32_t i = 0; i < given.Length(); i++) matrices.push_back(matrixArgumentOf(given.Get(i)));
    std::vector<double> numbers;
    if (arguments.Length() > 2 && arguments.Get(2u).IsArray()) {
        const Napi::Array values = arguments.Get(2u).As<Napi::Array>();
        for (uint32_t i = 0; i < values.Length(); i++) numbers.push_back(numberAt(values, i, "An option"));
    }
    std::string option = arguments.Length() > 3 && arguments.Get(3u).IsString() ? arguments.Get(3u).As<Napi::String>().Utf8Value() : std::string();
    return [operation, matrices, numbers, option] {
        auto results = std::make_shared<std::vector<MatrixResult>>(linalgOf(operation, matrices, numbers, option));
        return Builder([results](Napi::Env env) {
            Napi::Array array = Napi::Array::New(env, results->size());
            for (uint32_t i = 0; i < results->size(); i++) {
                const MatrixResult &result = (*results)[i];
                Napi::Float64Array data = Napi::Float64Array::New(env, result.values.size());
                if (!result.values.empty()) std::memcpy(data.Data(), result.values.data(), result.values.size() * sizeof(double));
                Napi::Array matrix = Napi::Array::New(env, 3);
                matrix.Set(0u, static_cast<double>(result.rows));
                matrix.Set(1u, static_cast<double>(result.columns));
                matrix.Set(2u, data);
                array.Set(i, matrix);
            }
            return array;
        });
    };
}

//A sparse matrix given as [rows, columns, Int32Array of the row pointers, Int32Array of the columns, Float64Array of
//the values]: the lengths are checked here, the structure by sparseOf()
SparseArgument sparseArgumentOf(const Napi::Value &value)
{
    if (!value.IsArray()) throw MathError(ErrorCode::Argument, "A sparse matrix is given as [rows, columns, Int32Array, Int32Array, Float64Array]");
    const Napi::Array parts = value.As<Napi::Array>();
    auto dimension = [](const Napi::Value &number) {
        if (!number.IsNumber()) throw MathError(ErrorCode::Argument, "A dimension of a sparse matrix is not a number");
        const double size = number.As<Napi::Number>().DoubleValue();
        if (size != std::floor(size) || size < 0 || size > 2147483647.0) throw MathError(ErrorCode::Argument, "A dimension of a sparse matrix is not an integer from 0 to 2^31 - 1");
        return static_cast<size_t>(size);
    };
    auto integers = [](const Napi::Value &array, const char *what) {
        if (!array.IsTypedArray() || array.As<Napi::TypedArray>().TypedArrayType() != napi_int32_array) throw MathError(ErrorCode::Argument, std::string(what) + " of a sparse matrix are not an Int32Array");
        return array.As<Napi::Int32Array>();
    };
    SparseArgument matrix;
    matrix.rows = dimension(parts.Get(0u));
    matrix.columns = dimension(parts.Get(1u));
    const Napi::Int32Array pointers = integers(parts.Get(2u), "The row pointers"), indices = integers(parts.Get(3u), "The columns");
    const Napi::Value data = parts.Get(4u);
    if (!data.IsTypedArray() || data.As<Napi::TypedArray>().TypedArrayType() != napi_float64_array) throw MathError(ErrorCode::Argument, "The values of a sparse matrix are not a Float64Array");
    const Napi::Float64Array values = data.As<Napi::Float64Array>();
    if (pointers.ElementLength() != matrix.rows + 1) throw MathError(ErrorCode::Argument, "A sparse matrix of " + std::to_string(matrix.rows) + " rows has " + std::to_string(pointers.ElementLength()) + " row pointers");
    if (indices.ElementLength() != values.ElementLength()) throw MathError(ErrorCode::Argument, "A sparse matrix has " + std::to_string(indices.ElementLength()) + " columns of entries and " + std::to_string(values.ElementLength()) + " values");
    matrix.entries = values.ElementLength();
    if (copyingArguments || !aligned(pointers.Data()) || !aligned(indices.Data()) || !aligned(values.Data())) {
        matrix.ownedPointers = std::make_shared<const std::vector<int32_t>>(elementsOf(pointers));
        matrix.ownedIndices = std::make_shared<const std::vector<int32_t>>(elementsOf(indices));
        matrix.ownedValues = std::make_shared<const std::vector<double>>(elementsOf(values));
        matrix.pointers = matrix.ownedPointers->data();
        matrix.indices = matrix.ownedIndices->data();
        matrix.values = matrix.ownedValues->data();
    } else {
        matrix.pointers = pointers.Data();
        matrix.indices = indices.Data();
        matrix.values = values.Data();
    }
    return matrix;
}

//sparse(operation, sparse matrices, dense matrices, numbers?): an operation on sparse matrices; its results as
//[[dense matrices as [rows, columns, Float64Array]], [sparse matrices as [rows, columns, Int32Array, Int32Array,
//Float64Array]]]
Job sparseJob(const Napi::Array &arguments)
{
    std::string operation = stringAt(arguments, 0, "The operation");
    auto listAt = [&arguments](uint32_t index, const char *what) {
        const Napi::Value list = arguments.Get(index);
        if (!list.IsArray()) throw MathError(ErrorCode::Argument, std::string(what) + " of an operation are an array");
        return list.As<Napi::Array>();
    };
    std::vector<SparseArgument> sparse;
    const Napi::Array sparseList = listAt(1, "The sparse matrices");
    for (uint32_t i = 0; i < sparseList.Length(); i++) sparse.push_back(sparseArgumentOf(sparseList.Get(i)));
    std::vector<MatrixArgument> dense;
    const Napi::Array denseList = listAt(2, "The matrices");
    for (uint32_t i = 0; i < denseList.Length(); i++) dense.push_back(matrixArgumentOf(denseList.Get(i)));
    std::vector<double> numbers;
    if (arguments.Length() > 3 && arguments.Get(3u).IsArray()) {
        const Napi::Array values = arguments.Get(3u).As<Napi::Array>();
        for (uint32_t i = 0; i < values.Length(); i++) numbers.push_back(numberAt(values, i, "An option"));
    }
    return [operation, sparse, dense, numbers] {
        auto results = std::make_shared<SparseResults>(sparseOf(operation, sparse, dense, numbers));
        return Builder([results](Napi::Env env) {
            Napi::Array denseResults = Napi::Array::New(env, results->dense.size());
            for (uint32_t i = 0; i < results->dense.size(); i++) {
                const MatrixResult &result = results->dense[i];
                Napi::Float64Array data = Napi::Float64Array::New(env, result.values.size());
                if (!result.values.empty()) std::memcpy(data.Data(), result.values.data(), result.values.size() * sizeof(double));
                Napi::Array matrix = Napi::Array::New(env, 3);
                matrix.Set(0u, static_cast<double>(result.rows));
                matrix.Set(1u, static_cast<double>(result.columns));
                matrix.Set(2u, data);
                denseResults.Set(i, matrix);
            }
            Napi::Array sparseResults = Napi::Array::New(env, results->sparse.size());
            for (uint32_t i = 0; i < results->sparse.size(); i++) {
                const SparseResult &result = results->sparse[i];
                Napi::Int32Array pointers = Napi::Int32Array::New(env, result.pointers.size());
                Napi::Int32Array indices = Napi::Int32Array::New(env, result.indices.size());
                Napi::Float64Array values = Napi::Float64Array::New(env, result.values.size());
                if (!result.pointers.empty()) std::memcpy(pointers.Data(), result.pointers.data(), result.pointers.size() * sizeof(int32_t));
                if (!result.indices.empty()) std::memcpy(indices.Data(), result.indices.data(), result.indices.size() * sizeof(int32_t));
                if (!result.values.empty()) std::memcpy(values.Data(), result.values.data(), result.values.size() * sizeof(double));
                Napi::Array matrix = Napi::Array::New(env, 5);
                matrix.Set(0u, static_cast<double>(result.rows));
                matrix.Set(1u, static_cast<double>(result.columns));
                matrix.Set(2u, pointers);
                matrix.Set(3u, indices);
                matrix.Set(4u, values);
                sparseResults.Set(i, matrix);
            }
            Napi::Array array = Napi::Array::New(env, 2);
            array.Set(0u, denseResults);
            array.Set(1u, sparseResults);
            return array;
        });
    };
}

//stats(operation, vectors as Float64Arrays, numbers?): a statistic of vectors; its results as Float64Arrays
Job statisticsJob(const Napi::Array &arguments)
{
    std::string operation = stringAt(arguments, 0, "The operation");
    const Napi::Value list = arguments.Get(1u);
    if (!list.IsArray()) throw MathError(ErrorCode::Argument, "The vectors of a statistic are an array");
    std::vector<VectorArgument> vectors;
    const Napi::Array given = list.As<Napi::Array>();
    for (uint32_t i = 0; i < given.Length(); i++) {
        const Napi::Value value = given.Get(i);
        if (!value.IsTypedArray() || value.As<Napi::TypedArray>().TypedArrayType() != napi_float64_array) throw MathError(ErrorCode::Argument, "The values of a statistic are a Float64Array");
        const Napi::Float64Array elements = value.As<Napi::Float64Array>();
        VectorArgument vector;
        vector.size = elements.ElementLength();
        if (copyingArguments || !aligned(elements.Data())) {
            vector.owned = std::make_shared<const std::vector<double>>(elementsOf(elements));
            vector.values = vector.owned->data();
        } else {
            vector.values = elements.Data();
        }
        vectors.push_back(vector);
    }
    std::vector<double> numbers;
    if (arguments.Length() > 2 && arguments.Get(2u).IsArray()) {
        const Napi::Array values = arguments.Get(2u).As<Napi::Array>();
        for (uint32_t i = 0; i < values.Length(); i++) numbers.push_back(numberAt(values, i, "An option"));
    }
    return [operation, vectors, numbers] {
        auto results = std::make_shared<std::vector<std::vector<double>>>(statisticsOf(operation, vectors, numbers));
        return Builder([results](Napi::Env env) {
            Napi::Array array = Napi::Array::New(env, results->size());
            for (uint32_t i = 0; i < results->size(); i++) {
                const std::vector<double> &result = (*results)[i];
                Napi::Float64Array data = Napi::Float64Array::New(env, result.size());
                if (!result.empty()) std::memcpy(data.Data(), result.data(), result.size() * sizeof(double));
                array.Set(i, data);
            }
            return array;
        });
    };
}

//The four words of the state of a random generator: a BigUint64Array, which a synchronous operation advances in
//place (an asynchronous one would change it from another thread: refused)
uint64_t *generatorStateAt(const Napi::Array &arguments, uint32_t index)
{
    if (copyingArguments) throw MathError(ErrorCode::Argument, "The random numbers are drawn synchronously");
    const Napi::Value value = arguments.Get(index);
    if (!value.IsTypedArray() || value.As<Napi::TypedArray>().TypedArrayType() != napi_biguint64_array) throw MathError(ErrorCode::Argument, "The state of a random generator is a BigUint64Array");
    Napi::TypedArrayOf<uint64_t> state = value.As<Napi::TypedArrayOf<uint64_t>>();
    if (state.ElementLength() != 4) throw MathError(ErrorCode::Argument, "The state of a random generator has 4 words");
    return state.Data();
}

//An operation on the state of a generator, on an aligned copy written back after (see aligned())
template <typename F>
auto withState(uint64_t *state, F &&operation)
{
    uint64_t words[4];
    std::memcpy(words, state, sizeof(words));
    auto result = operation(words);
    std::memcpy(state, words, sizeof(words));
    return result;
}

size_t countAt(const Napi::Array &arguments, uint32_t index)
{
    const double count = numberAt(arguments, index, "The count");
    if (count != std::floor(count) || count < 0 || count > 4294967295.0) throw MathError(ErrorCode::Argument, "The count of random numbers is an integer of 0 or more");
    return static_cast<size_t>(count);
}

Builder vectorBuilder(std::vector<double> values)
{
    auto results = std::make_shared<std::vector<double>>(std::move(values));
    return Builder([results](Napi::Env env) {
        Napi::Float64Array data = Napi::Float64Array::New(env, results->size());
        if (!results->empty()) std::memcpy(data.Data(), results->data(), results->size() * sizeof(double));
        return data;
    });
}

//distribution(function, name, parameters, values | count, state?): describe (its support and moments), pdf, cdf,
//survival, quantile, survivalQuantile of values, or a sample of a count by the generator of a state
Job distributionJob(const Napi::Array &arguments)
{
    const std::string function = stringAt(arguments, 0, "The function");
    const std::string name = stringAt(arguments, 1, "The distribution");
    const Napi::Value list = arguments.Get(2u);
    if (!list.IsArray()) throw MathError(ErrorCode::Argument, "The parameters of a distribution are an array");
    std::vector<double> parameters;
    const Napi::Array given = list.As<Napi::Array>();
    for (uint32_t i = 0; i < given.Length(); i++) parameters.push_back(numberAt(given, i, "A parameter"));
    if (function == "describe") {
        return [name, parameters] { return vectorBuilder(describeDistribution(name, parameters)); };
    }
    if (function == "sample") {
        const size_t count = countAt(arguments, 3);
        uint64_t *state = generatorStateAt(arguments, 4);
        return [name, parameters, count, state] { return withState(state, [&name, &parameters, count](uint64_t *words) { return vectorBuilder(sampleDistribution(name, parameters, count, words)); }); };
    }
    const Napi::Value data = arguments.Get(3u);
    if (!data.IsTypedArray() || data.As<Napi::TypedArray>().TypedArrayType() != napi_float64_array) throw MathError(ErrorCode::Argument, "The values of a distribution are a Float64Array");
    const Napi::Float64Array elements = data.As<Napi::Float64Array>();
    auto values = std::make_shared<const std::vector<double>>(elements.Data(), elements.Data() + elements.ElementLength());
    return [function, name, parameters, values] { return vectorBuilder(distributionAt(name, parameters, function, values->data(), values->size())); };
}

//random(operation, state, ...): seed (of a BigUint64Array of one word), uniform (count), integers (count, lower, upper)
Job randomJob(const Napi::Array &arguments)
{
    const std::string operation = stringAt(arguments, 0, "The operation");
    uint64_t *state = generatorStateAt(arguments, 1);
    if (operation == "seed") {
        const Napi::Value value = arguments.Get(2u);
        if (!value.IsTypedArray() || value.As<Napi::TypedArray>().TypedArrayType() != napi_biguint64_array) throw MathError(ErrorCode::Argument, "The seed is a BigUint64Array");
        const std::vector<uint64_t> words = elementsOf(value.As<Napi::TypedArrayOf<uint64_t>>());
        if (words.empty()) throw MathError(ErrorCode::Argument, "The seed is a BigUint64Array of one word");
        const uint64_t seed = words[0];
        return [state, seed] {
            return withState(state, [seed](uint64_t *words) {
                seedGenerator(seed, words);
                return vectorBuilder({});
            });
        };
    }
    const size_t count = countAt(arguments, 2);
    if (operation == "uniform") return [count, state] { return withState(state, [count](uint64_t *words) { return vectorBuilder(uniformNumbers(count, words)); }); };
    if (operation == "integers") {
        const double lower = numberAt(arguments, 3, "The lower bound"), upper = numberAt(arguments, 4, "The upper bound");
        return [count, state, lower, upper] { return withState(state, [count, lower, upper](uint64_t *words) { return vectorBuilder(uniformIntegers(count, lower, upper, words)); }); };
    }
    throw MathError(ErrorCode::Argument, "Unknown operation of a random generator: " + operation);
}

Napi::Float64Array float64ArrayOf(Napi::Env env, const std::vector<double> &values)
{
    Napi::Float64Array array = Napi::Float64Array::New(env, values.size());
    if (!values.empty()) std::memcpy(array.Data(), values.data(), values.size() * sizeof(double));
    return array;
}

Napi::Value iterativeValue(Napi::Env env, const IterativeResult &result)
{
    Napi::Object value = Napi::Object::New(env);
    value.Set("solution", float64ArrayOf(env, result.solution));
    value.Set("converged", result.converged);
    value.Set("iterations", static_cast<double>(result.iterations));
    value.Set("residual", result.residual);
    return value;
}

size_t iterationsAt(const Napi::Array &arguments, uint32_t index)
{
    const double iterations = numberAt(arguments, index, "The largest number of iterations");
    if (iterations != std::floor(iterations) || iterations < 0 || iterations > 1e9) throw MathError(ErrorCode::Argument, "The largest number of iterations is an integer from 0 to 10^9");
    return static_cast<size_t>(iterations);
}

//polynomialRoots(polynomial, variable) or polynomialRoots(Float64Array of the coefficients from the constant term
//up): {re, im}
Job polynomialRootsJob(const Napi::Array &arguments)
{
    const Napi::Value first = arguments.Get(0u);
    std::optional<std::vector<std::complex<double>>> coefficients;
    Expr polynomial;
    std::string variable;
    if (first.IsTypedArray() && first.As<Napi::TypedArray>().TypedArrayType() == napi_float64_array) {
        const Napi::Float64Array given = first.As<Napi::Float64Array>();
        const std::vector<double> values = elementsOf(given);
        coefficients = std::vector<std::complex<double>>(values.begin(), values.end());
    } else {
        polynomial = expressionAt(arguments, 0);
        variable = stringAt(arguments, 1, "The variable");
    }
    return [coefficients, polynomial, variable] {
        auto roots = std::make_shared<ComplexRoots>(coefficients ? polynomialRootsOf(*coefficients) : polynomialRootsOf(polynomial, variable));
        return Builder([roots](Napi::Env env) {
            Napi::Object value = Napi::Object::New(env);
            value.Set("re", float64ArrayOf(env, roots->re));
            value.Set("im", float64ArrayOf(env, roots->im));
            return value;
        });
    };
}

//findRoot(function, variable, bracket [a, b] or null, guess or null, tolerance, maxIterations)
Job findRootJob(const Napi::Array &arguments)
{
    const Expr function = expressionAt(arguments, 0);
    const std::string variable = stringAt(arguments, 1, "The variable");
    std::optional<std::pair<double, double>> bracket;
    std::optional<double> guess;
    if (arguments.Get(2u).IsArray()) {
        const Napi::Array ends = arguments.Get(2u).As<Napi::Array>();
        if (ends.Length() != 2) throw MathError(ErrorCode::Argument, "A bracket is [a, b]");
        bracket = std::make_pair(numberAt(ends, 0, "An end of the bracket"), numberAt(ends, 1, "An end of the bracket"));
    }
    if (arguments.Get(3u).IsNumber()) guess = numberAt(arguments, 3, "The guess");
    if (!bracket && !guess) throw MathError(ErrorCode::Argument, "A root is found in a bracket or from a guess");
    const double tolerance = numberAt(arguments, 4, "The tolerance");
    const size_t iterations = iterationsAt(arguments, 5);
    return [function, variable, bracket, guess, tolerance, iterations] {
        auto result = std::make_shared<IterativeResult>(findRootOf(function, variable, bracket, guess, tolerance, iterations));
        return Builder([result](Napi::Env env) { return iterativeValue(env, *result); });
    };
}

//solveSystem(equations, variables, guess (Float64Array), tolerance, maxIterations)
Job solveSystemJob(const Napi::Array &arguments)
{
    const std::vector<Expr> equations = expressionsAt(arguments, 0);
    const std::vector<std::string> variables = stringsAt(arguments, 1);
    const Napi::Value given = arguments.Get(2u);
    if (!given.IsTypedArray() || given.As<Napi::TypedArray>().TypedArrayType() != napi_float64_array) throw MathError(ErrorCode::Argument, "The guess is a Float64Array");
    const Napi::Float64Array values = given.As<Napi::Float64Array>();
    const std::vector<double> guess = elementsOf(values);
    const double tolerance = numberAt(arguments, 3, "The tolerance");
    const size_t iterations = iterationsAt(arguments, 4);
    return [equations, variables, guess, tolerance, iterations] {
        auto result = std::make_shared<IterativeResult>(solveSystemOf(equations, variables, guess, tolerance, iterations));
        return Builder([result](Napi::Env env) { return iterativeValue(env, *result); });
    };
}

//integrate(function, variable, a, b, points (Float64Array), tolerance): {value, error, converged}
Job integrateJob(const Napi::Array &arguments)
{
    const Expr function = expressionAt(arguments, 0);
    const std::string variable = stringAt(arguments, 1, "The variable");
    const double a = numberAt(arguments, 2, "The start of the interval"), b = numberAt(arguments, 3, "The end of the interval");
    const Napi::Value given = arguments.Get(4u);
    if (!given.IsTypedArray() || given.As<Napi::TypedArray>().TypedArrayType() != napi_float64_array) throw MathError(ErrorCode::Argument, "The points are a Float64Array");
    const Napi::Float64Array values = given.As<Napi::Float64Array>();
    const std::vector<double> points = elementsOf(values);
    const double tolerance = numberAt(arguments, 5, "The tolerance");
    return [function, variable, a, b, points, tolerance] {
        const IntegralResult result = integralOf(function, variable, a, b, points, tolerance);
        return Builder([result](Napi::Env env) {
            Napi::Object value = Napi::Object::New(env);
            value.Set("value", result.value);
            value.Set("error", result.error);
            value.Set("converged", result.converged);
            return value;
        });
    };
}

//solveODE(derivatives, states, time, t0, t1, initial (Float64Array), method, relativeTolerance, absoluteTolerance,
//maxStep, points (Float64Array), maxSteps): {t, y (rows of states), columns, steps, rejected, evaluations, jacobians,
//completed, message}
Job solveODEJob(const Napi::Array &arguments)
{
    const std::vector<Expr> derivatives = expressionsAt(arguments, 0);
    const std::vector<std::string> states = stringsAt(arguments, 1);
    const std::string time = stringAt(arguments, 2, "The time");
    const double t0 = numberAt(arguments, 3, "The start of the span"), t1 = numberAt(arguments, 4, "The end of the span");
    const auto arrayAt = [&arguments](uint32_t index, const char *what) {
        const Napi::Value given = arguments.Get(index);
        if (!given.IsTypedArray() || given.As<Napi::TypedArray>().TypedArrayType() != napi_float64_array) throw MathError(ErrorCode::Argument, std::string(what) + " are a Float64Array");
        const Napi::Float64Array values = given.As<Napi::Float64Array>();
        return elementsOf(values);
    };
    const std::vector<double> initial = arrayAt(5, "The initial values");
    ODEOptions options;
    options.method = stringAt(arguments, 6, "The method");
    options.relativeTolerance = numberAt(arguments, 7, "The relative tolerance");
    options.absoluteTolerance = numberAt(arguments, 8, "The absolute tolerance");
    options.maxStep = numberAt(arguments, 9, "The largest step");
    options.points = arrayAt(10, "The points");
    options.maxSteps = iterationsAt(arguments, 11);
    return [derivatives, states, time, t0, t1, initial, options] {
        auto result = std::make_shared<ODEResult>(solveODEOf(derivatives, states, time, t0, t1, initial, options));
        return Builder([result](Napi::Env env) {
            Napi::Object value = Napi::Object::New(env);
            value.Set("t", float64ArrayOf(env, result->t));
            value.Set("y", float64ArrayOf(env, result->y));
            value.Set("steps", static_cast<double>(result->steps));
            value.Set("rejected", static_cast<double>(result->rejected));
            value.Set("evaluations", static_cast<double>(result->evaluations));
            value.Set("jacobians", static_cast<double>(result->jacobians));
            value.Set("completed", result->completed);
            if (!result->message.empty()) value.Set("message", result->message);
            return value;
        });
    };
}

//The value of a matrix of expressions for JavaScript: {matrix, rows, columns}
Napi::Value matrixValue(Napi::Env env, const MatrixPointer &matrix)
{
    Napi::Object value = Napi::Object::New(env);
    value.Set("matrix", wrapMatrix(env, matrix));
    value.Set("rows", static_cast<double>(matrix->rows));
    value.Set("columns", static_cast<double>(matrix->columns));
    return value;
}

//matrix(operation, matrices, expressions, numbers, names): an operation of the matrices of expressions; its result as
//{matrix?, expression?, matrices?, expressions?, numbers?, text?}
Job matrixJob(const Napi::Array &arguments)
{
    const std::string operation = stringAt(arguments, 0, "The operation");
    const auto arrayAt = [&arguments](uint32_t index, const char *what) {
        const Napi::Value value = arguments.Get(index);
        if (!value.IsArray()) throw MathError(ErrorCode::Argument, std::string(what) + " are an array");
        return value.As<Napi::Array>();
    };
    std::vector<MatrixPointer> matrices;
    const Napi::Array givenMatrices = arrayAt(1, "The matrices");
    for (uint32_t i = 0; i < givenMatrices.Length(); i++) matrices.push_back(unwrapMatrix(givenMatrices.Get(i)));
    const std::vector<Expr> expressions = expressionsAt(arguments, 2);
    std::vector<double> numbers;
    const Napi::Array givenNumbers = arrayAt(3, "The numbers");
    for (uint32_t i = 0; i < givenNumbers.Length(); i++) numbers.push_back(numberAt(givenNumbers, i, "A number"));
    const std::vector<std::string> names = stringsAt(arguments, 4);
    return [operation, matrices, expressions, numbers, names] {
        auto result = std::make_shared<ExpressionMatrixResult>(matrixOperation(operation, matrices, expressions, numbers, names));
        return Builder([result](Napi::Env env) {
            Napi::Object value = Napi::Object::New(env);
            if (result->matrix) value.Set("matrix", matrixValue(env, result->matrix));
            if (!result->expression.is_null()) value.Set("expression", wrapExpression(env, result->expression));
            Napi::Array matrices = Napi::Array::New(env, result->matrices.size());
            for (uint32_t i = 0; i < result->matrices.size(); i++) matrices.Set(i, matrixValue(env, result->matrices[i]));
            value.Set("matrices", matrices);
            value.Set("expressions", expressionsValue(env, result->expressions));
            Napi::Array numbers = Napi::Array::New(env, result->numbers.size());
            for (uint32_t i = 0; i < result->numbers.size(); i++) numbers.Set(i, result->numbers[i]);
            value.Set("numbers", numbers);
            value.Set("text", result->text);
            return value;
        });
    };
}

Job polyJob(const Napi::Array &arguments)
{
    const std::string operation = stringAt(arguments, 0, "The operation");
    const std::vector<Expr> expressions = expressionsAt(arguments, 1);
    const std::vector<std::string> names = stringsAt(arguments, 2);
    return [operation, expressions, names] {
        auto result = std::make_shared<PolyResult>(polyOperation(operation, expressions, names));
        return Builder([result](Napi::Env env) {
            Napi::Object value = Napi::Object::New(env);
            if (!result->expression.is_null()) value.Set("expression", wrapExpression(env, result->expression));
            value.Set("expressions", expressionsValue(env, result->expressions));
            Napi::Array numbers = Napi::Array::New(env, result->numbers.size());
            for (uint32_t i = 0; i < result->numbers.size(); i++) numbers.Set(i, result->numbers[i]);
            value.Set("numbers", numbers);
            value.Set("text", result->text);
            return value;
        });
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
        {"series", seriesJob}, {"solve", solveJob}, {"inequality", inequalityJob}, {"limit", limitJob}, {"integral", integralJob}, {"laplace", laplaceJob}, {"solveLinear", solveLinearJob}, {"equals", equalsJob},
        {"decimal", decimalJob}, {"complexDecimal", complexDecimalJob}, {"linalg", linalgJob}, {"sparse", sparseJob}, {"stats", statisticsJob}, {"distribution", distributionJob}, {"random", randomJob}, {"polynomialRoots", polynomialRootsJob}, {"findRoot", findRootJob}, {"solveSystem", solveSystemJob}, {"integrate", integrateJob}, {"solveODE", solveODEJob}, {"matrix", matrixJob}, {"poly", polyJob}, {"decimalOperation", decimalOperationJob}, {"arithmetic", arithmeticJob}, {"fraction", fractionJob}, {"coefficients", coefficientsJob},
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
    Job job;
    {
        const CopyingArguments copying;
        job = jobOf(info);
    }
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

//parse(scope, text): {kind: 'expression' | 'equation' | 'relation', left, right?, relation?}, or {kind: 'matrix',
//matrix: {matrix, rows, columns}}
Napi::Value Parse(const Napi::CallbackInfo &info)
{
    std::shared_ptr<const Scope> scope = unwrap<const Scope>(info[0], SCOPE_TAG, "a scope");
    if (!info[1].IsString()) throw MathError(ErrorCode::Argument, "The formula is not a string");
    const std::string text = info[1].As<Napi::String>().Utf8Value();
    Parsed parsed = parse(text, scope->resolver());
    Napi::Object result = Napi::Object::New(info.Env());
    if (parsed.kind == Parsed::Kind::Matrix) {
        result.Set("kind", "matrix");
        result.Set("matrix", matrixValue(info.Env(), parsed.matrix));
        return result;
    }
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

//A formula compiled into a function of numbers (CompiledFunction, of one output)
struct Compiled {
    std::unique_ptr<CompiledFunction> function;
    size_t inputs;

    void call(double *result, const double *values)
    {
        function->call(result, values);
    }
};

//compile(expression, variables): a compiled function
Napi::Value Compile(const Napi::CallbackInfo &info)
{
    Expr expression = unwrapExpression(info[0]);
    Napi::Array names = info[1].As<Napi::Array>();
    std::vector<std::string> given;
    for (uint32_t i = 0; i < names.Length(); i++) given.push_back(stringAt(names, i, "A variable"));
    auto compiled = std::make_shared<Compiled>();
    compiled->inputs = given.size();
    try {
        compiled->function = std::make_unique<CompiledFunction>(given, std::vector<Expr>{expression});
    } catch (const MathError &error) {
        //The message of a compilation names its expression
        if (error.code() == ErrorCode::NotSupported) throw MathError(ErrorCode::NotSupported, "The expression cannot be compiled: " + toText(expression) + " has a function without a compiled form");
        throw;
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
    //(on aligned copies, see aligned())
    const std::vector<double> given = elementsOf(inputs);
    std::vector<double> values(rows);
    for (size_t row = 0; row < rows; row++) compiled->call(values.data() + row, given.data() + row * width);
    return float64ArrayOf(info.Env(), values);
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
