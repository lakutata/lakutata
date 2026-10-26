//The functions of the formulas SymEngine has not, as its function wrappers (its extension): exact for the arguments
//they can be computed for, kept as calls otherwise, with their derivatives and their numeric values
#pragma once

#include <complex>
#include <vector>

#include <symengine/functions.h>

#include "../core/Handle.h"

namespace math {

//The base of the functions: their numeric value from the numeric values of their arguments (evaluated, compiled)
class MathFunction : public SymEngine::FunctionWrapper {
public:
    using SymEngine::FunctionWrapper::FunctionWrapper;

    //The value for numbers: NaN where the function has none
    virtual std::complex<double> value(const std::vector<std::complex<double>> &arguments) const = 0;

    SymEngine::RCP<const SymEngine::Number> eval(long bits) const override;

    double evaluate_real(const double *arguments) const override;

    std::complex<double> evaluate_complex(const std::complex<double> *arguments) const override;
};

//The n-th root of x: the real root of a negative real x for an odd n (cbrt(-8) is -2), the principal one otherwise (as
//x^(1/n)); written cbrt(x) for n = 3
class RealRoot : public MathFunction {
public:
    RealRoot(const Expr &x, const Expr &n);

    Expr create(const SymEngine::vec_basic &arguments) const override;

    Expr diff_impl(const SymEngine::RCP<const SymEngine::Symbol> &variable) const override;

    std::complex<double> value(const std::vector<std::complex<double>> &arguments) const override;
};

//root(x, n): the root of x of order n, exact where it can be, a call where the sign of x is not known
Expr realRoot(const Expr &x, const Expr &n);

//round(x): the nearest integer, halves away from zero (round(-2.5) is -3); of each part of a complex number
class Round : public MathFunction {
public:
    explicit Round(const Expr &x);

    Expr create(const SymEngine::vec_basic &arguments) const override;

    Expr diff_impl(const SymEngine::RCP<const SymEngine::Symbol> &variable) const override;

    std::complex<double> value(const std::vector<std::complex<double>> &arguments) const override;
};

Expr roundOf(const Expr &x);

//mod(a, b): a - b floor(a/b), of the sign of b (mod(-7, 3) is 2)
class Mod : public MathFunction {
public:
    Mod(const Expr &a, const Expr &b);

    Expr create(const SymEngine::vec_basic &arguments) const override;

    Expr diff_impl(const SymEngine::RCP<const SymEngine::Symbol> &variable) const override;

    std::complex<double> value(const std::vector<std::complex<double>> &arguments) const override;
};

Expr modOf(const Expr &a, const Expr &b);

//sinc(x): sin(x)/x, 1 at 0
class Sinc : public MathFunction {
public:
    explicit Sinc(const Expr &x);

    Expr create(const SymEngine::vec_basic &arguments) const override;

    Expr diff_impl(const SymEngine::RCP<const SymEngine::Symbol> &variable) const override;

    std::complex<double> value(const std::vector<std::complex<double>> &arguments) const override;
};

Expr sincOf(const Expr &x);

//re(z), im(z), arg(z): the real part, the imaginary part, the argument of a complex number (arg(0) is nan); the
//variables are complex numbers, so that re(x) stays a call
class ComplexPart : public MathFunction {
public:
    enum class Part { Real, Imaginary, Argument };

    ComplexPart(Part part, const Expr &z);

    Expr create(const SymEngine::vec_basic &arguments) const override;

    Expr diff_impl(const SymEngine::RCP<const SymEngine::Symbol> &variable) const override;

    std::complex<double> value(const std::vector<std::complex<double>> &arguments) const override;

private:
    Part part_;
};

Expr realPartOf(const Expr &z);

Expr imaginaryPartOf(const Expr &z);

Expr argumentOf(const Expr &z);

}
