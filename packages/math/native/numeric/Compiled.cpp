#include "Compiled.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include <symengine/symbol.h>

#include "../core/Errors.h"

namespace math {

CompiledFunction::CompiledFunction(const std::vector<std::string> &inputs, const std::vector<Expr> &outputs)
    : inputCount(inputs.size()), outputCount(outputs.size()), complexInputs(inputs.size()), complexOutputs(outputs.size())
{
    SymEngine::vec_basic symbols, formulas(outputs.begin(), outputs.end());
    for (const std::string &name : inputs) symbols.push_back(SymEngine::symbol(name));
    for (const Expr &output : outputs) {
        for (const std::string &used : variablesOf(output)) {
            if (std::find(inputs.begin(), inputs.end(), used) == inputs.end()) throw MathError(ErrorCode::Argument, "The variable " + used + " of the expression is not an input of the function");
        }
    }
    //Their common subexpressions computed once, where there are several
    const bool shared = outputs.size() > 1;
    try {
        real.init(symbols, formulas, shared);
        realBuilt = true;
    } catch (SymEngine::SymEngineException &) {
    }
    try {
        auto visitor = std::make_unique<SymEngine::LambdaComplexDoubleVisitor>();
        visitor->init(symbols, formulas, shared);
        complex = std::move(visitor);
    } catch (SymEngine::SymEngineException &) {
    }
    if (!realBuilt && !complex) {
        throw MathError(ErrorCode::NotSupported, "The expression cannot be compiled: it has a function without a compiled form");
    }
}

void CompiledFunction::call(double *results, const double *values)
{
    if (realBuilt) {
        real.call(results, values);
        if (!complex || std::none_of(results, results + outputCount, [](double value) { return std::isnan(value); })) return;
    }
    for (size_t i = 0; i < inputCount; i++) complexInputs[i] = values[i];
    complex->call(complexOutputs.data(), complexInputs.data());
    for (size_t i = 0; i < outputCount; i++) {
        if (realBuilt && !std::isnan(results[i])) continue;
        const std::complex<double> &value = complexOutputs[i];
        results[i] = std::abs(value.imag()) <= 1e-12 * std::max(1.0, std::abs(value.real())) ? value.real() : std::numeric_limits<double>::quiet_NaN();
    }
}

}
