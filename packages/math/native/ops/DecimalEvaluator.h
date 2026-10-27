//The evaluation of an expression to a decimal and the error of each value (Decimal.cpp): the real evaluator, whose
//nodes the complex one (DecimalComplex.cpp) computes too when their arguments are real
#pragma once

#include <functional>
#include <limits>
#include <string>
#include <vector>

#include <symengine/basic.h>

#include "Decimal.h"
#include "../core/Errors.h"

namespace math {

//A value and the decimal exponent of its absolute error (the roundings, propagated): a value within its error of 0
//is 0, an argument within its error of a jump of floor() is at the jump
struct Approximation {
    Decimal value;
    double noise;
};

//No error (an exact integer)
constexpr double EXACT = -1e18;

//A value that cannot be told from 0 where it must not be 0 (the base of a negative power, the argument of a
//logarithm), or from a jump of a function: undecided below the last precision, or at it while its error is above what
//the evaluation decides (an argument too large for the digits: sin(10^(10^4))), which tries again with more digits;
//the noise of the value, to tell whether more digits make it smaller
struct Undecided {
    double noise = EXACT;
};

class Evaluator {
public:
    //The last evaluation (the most guard digits) decides: a value that cannot be told from 0 is 0 there, from a jump at
    //the jump, if its error is not above 10^decidable (undecided otherwise: more digits)
    Evaluator(const DecimalContext &context, bool last, double decidable = std::numeric_limits<double>::infinity());

    //The value of an expression: its arguments evaluated, then its node
    Approximation evaluate(const SymEngine::Basic &e);
    //The value of a node from the values of its arguments, in the order of get_args() (the base of e^x is not read):
    //MathError Domain where it is not real
    Approximation apply(const SymEngine::Basic &e, const std::vector<Approximation> &arguments);
    //The arguments of a node that apply() reads: none for the base of e^x
    static std::vector<SymEngine::RCP<const SymEngine::Basic>> argumentsOf(const SymEngine::Basic &e);

    //Whether a value cannot be told from 0 at this precision
    bool zero(const Approximation &a) const;
    //A value that must not be 0 and cannot be told from it: the error of the last evaluation, undecided before
    void notZero(const Approximation &a, ErrorCode code, const std::string &error) const;
    //A decision on a value within its error (0, a jump): undecided at the last evaluation for an error above decidable
    void decide(double noise) const;
    //The exponent of the first digit of a value, EXACT for 0
    double exponent(const Decimal &value) const;
    //The rounding of a value to the digits of the context
    double rounding(const Decimal &value) const;
    bool last() const;

private:
    const DecimalContext &context_;
    double digits_;
    bool last_;
    double decidable_;

    double relative(const Decimal &result, const Approximation &of) const;
    Decimal one() const;
    Approximation jump(const Approximation &x, Decimal (DecimalContext::*apply)(const Decimal &) const, bool halves) const;
    void notAtPole(const Approximation &x, const std::string &function) const;
    double spread(const std::function<Decimal(const std::vector<Decimal> &)> &function, std::vector<Decimal> at, size_t index, const Approximation &x,
        const Decimal &value) const;
    Approximation special(const SymEngine::Basic &e, const std::vector<Approximation> &arguments);
    double slope(const SymEngine::Basic &e, const Decimal &x, const Decimal &v) const;
    Decimal elementary(const SymEngine::Basic &e, const Decimal &x) const;
    Approximation wrapper(const SymEngine::Basic &e, const std::vector<Approximation> &arguments);
};

}
