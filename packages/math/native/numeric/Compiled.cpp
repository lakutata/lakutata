#include "Compiled.h"

#include <algorithm>
#include <cmath>
#include <limits>

#include <symengine/complex_double.h>
#include <symengine/real_double.h>
#include <symengine/symbol.h>
#include <symengine/visitor.h>

#include "../core/Errors.h"
#include "../ops/Operations.h"
#include "../ops/Piecewise.h"

namespace math {

namespace {

//The parts without variables computed from their exact decimals, not in doubles: ln(erf(5)) is -1.5374597944280348e-12,
//of which the doubles of erf(5) = 1 - 1.5e-12 have 4 digits
class ConstantsComputed : public SymEngine::TransformVisitor {
public:
    using TransformVisitor::bvisit;

    SymEngine::RCP<const SymEngine::Basic> apply(const SymEngine::RCP<const SymEngine::Basic> &x) override
    {
        if (SymEngine::is_a_Number(*x) || SymEngine::is_a_Boolean(*x) || x->get_args().empty() || !SymEngine::free_symbols(*x).empty()) return TransformVisitor::apply(x);
        try {
            const std::complex<double> value = toComplex(x);
            if (std::isfinite(value.real()) && std::isfinite(value.imag())) {
                if (value.imag() == 0) return SymEngine::real_double(value.real());
                return SymEngine::complex_double(value);
            }
        } catch (const MathError &error) {
            if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        } catch (SymEngine::SymEngineException &) {
        }
        return x;
    }
};

}

CompiledFunction::CompiledFunction(const std::vector<std::string> &inputs, const std::vector<Expr> &outputs)
    : inputCount(inputs.size()), outputCount(outputs.size()), complexInputs(inputs.size()), complexOutputs(outputs.size())
{
    //A piecewise part takes nan where no case holds (the evaluations need a last case that is always true)
    SymEngine::vec_basic symbols, formulas;
    for (const Expr &output : outputs) {
        ConstantsComputed constants;
        formulas.push_back(constants.apply(withOtherwise(output)));
    }
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
