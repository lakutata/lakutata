//Formulas compiled into a function of numbers, for the compiled functions of expressions and the numeric solvers
#pragma once

#include <complex>
#include <memory>
#include <string>
#include <vector>

#include <symengine/lambda_double.h>

#include "../core/Handle.h"
#include "../ops/Operations.h"

namespace math {

//Formulas compiled into one function of numbers, by SymEngine's lambda visitors: the real one, and the complex one
//where the real one has no value (a complex value on the way: im(sqrt(y)) for y < 0) or cannot be built (i^i is real);
//a value is then the real part, NaN where it is not real. Several formulas share their common subexpressions. Not
//shared between threads: each operation compiles its own.
class CompiledFunction {
public:
    //The function of the variables of inputs (each a symbol) giving the outputs; the variables of the outputs must be
    //among the inputs (MathError Argument), a formula with a function without a compiled form is MathError
    //NotSupported
    CompiledFunction(const std::vector<std::string> &inputs, const std::vector<Expr> &outputs);

    size_t inputs() const
    {
        return inputCount;
    }

    size_t outputs() const
    {
        return outputCount;
    }

    void call(double *results, const double *values);

private:
    SymEngine::LambdaRealDoubleVisitor real;
    bool realBuilt = false;
    std::unique_ptr<SymEngine::LambdaComplexDoubleVisitor> complex;
    size_t inputCount = 0;
    size_t outputCount = 0;
    std::vector<std::complex<double>> complexInputs;
    std::vector<std::complex<double>> complexOutputs;
};

}
