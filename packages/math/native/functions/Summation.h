//The sums and the products of the formulas, sum(f, k, a, b) and product(f, k, a, b): f for k from a to b. The variable
//k is bound: it is a Dummy of SymEngine (its name, the depth of the sum as its index), so that it is not a variable of
//the expression, a substitution does not reach it and a derivative by the k outside is 0. A closed form is given where
//one is known; the others stay as calls (function wrappers), computed term by term between integers.
#pragma once

#include <string>

#include <symengine/symbol.h>

#include "Functions.h"

namespace math {

//The limits a and b: integers, or -inf and inf; b = a - 1 is an empty sum (0) or product (1), b < a - 1 is the sum of
//the other side with the sign changed (the reciprocal product), as in SymPy
class Summation : public MathFunction {
public:
    Summation(const std::string &name, const Expr &term, const Expr &index, const Expr &low, const Expr &high);

    Expr create(const SymEngine::vec_basic &arguments) const override;

    Expr diff_impl(const SymEngine::RCP<const SymEngine::Symbol> &variable) const override;

    std::complex<double> value(const std::vector<std::complex<double>> &arguments) const override;

    SymEngine::RCP<const SymEngine::Number> eval(long bits) const override;

    bool isSum() const;
};

//The sum of a term for its variable (a Dummy) from low to high: a closed form, or a call
Expr summationOf(const Expr &term, const SymEngine::RCP<const SymEngine::Symbol> &index, const Expr &low, const Expr &high);

//The product of a term for its variable from low to high: a closed form, or a call
Expr iteratedProductOf(const Expr &term, const SymEngine::RCP<const SymEngine::Symbol> &index, const Expr &low, const Expr &high);

//A sum or a product kept as a call, written as the sum or the product of its terms, for its value: its limits are
//integers, at most 10^4 terms apart (MathNotSupportedException otherwise)
Expr writtenOut(const SymEngine::Basic &call);

}
