#include "Functions.h"

#include <cmath>
#include <limits>

#include <symengine/add.h>
#include <symengine/complex_double.h>
#include <symengine/constants.h>
#include <symengine/eval_double.h>
#include <symengine/integer.h>
#include <symengine/mul.h>
#include <symengine/pow.h>
#include <symengine/real_double.h>
#include <symengine/test_visitors.h>

namespace math {

using namespace SymEngine;

RCP<const Number> MathFunction::eval(long) const
{
    //The arguments evaluated first: a variable among them fails as SymEngine's evaluations do
    std::vector<std::complex<double>> arguments;
    for (const Expr &argument : get_args()) arguments.push_back(eval_complex_double(*argument));
    const std::complex<double> result = value(arguments);
    if (result.imag() == 0) return real_double(result.real());
    return complex_double(result);
}

double MathFunction::evaluate_real(const double *arguments) const
{
    std::vector<std::complex<double>> values(arguments, arguments + get_args().size());
    const std::complex<double> result = value(values);
    return result.imag() == 0 ? result.real() : std::numeric_limits<double>::quiet_NaN();
}

std::complex<double> MathFunction::evaluate_complex(const std::complex<double> *arguments) const
{
    return value(std::vector<std::complex<double>>(arguments, arguments + get_args().size()));
}

namespace {

//Whether n is an odd positive integer
bool oddOrder(const Expr &n)
{
    if (!is_a<Integer>(*n)) return false;
    const Integer &order = down_cast<const Integer &>(*n);
    return order.is_positive() && !order.as_integer_class().is_zero() && order.as_integer_class() % 2 != 0;
}

}

RealRoot::RealRoot(const Expr &x, const Expr &n) : MathFunction("root", vec_basic{x, n})
{
}

Expr realRoot(const Expr &x, const Expr &n)
{
    //An even or a symbolic order, or a complex x: the principal root, x^(1/n)
    if (!oddOrder(n)) return pow(x, div(one, n));
    if (is_a_Number(*x) && !down_cast<const Number &>(*x).is_exact()) {
        //A floating-point number: its real root
        const double value = eval_double(*x);
        return real_double(value < 0 ? -std::pow(-value, 1.0 / eval_double(*n)) : std::pow(value, 1.0 / eval_double(*n)));
    }
    const tribool real = is_real(*x);
    if (is_false(real)) return pow(x, div(one, n));
    if (is_true(real)) {
        if (is_true(is_nonnegative(*x))) return pow(x, div(one, n));
        if (is_true(is_negative(*x))) return neg(pow(neg(x), div(one, n)));
    }
    //A variable-free real number of a sign SymEngine does not know (sqrt(2) - 2): its sign from its value
    if (free_symbols(*x).empty()) {
        try {
            const std::complex<double> value = eval_complex_double(*x);
            if (value.imag() == 0 && std::abs(value.real()) > 1e-10) return value.real() > 0 ? pow(x, div(one, n)) : neg(pow(neg(x), div(one, n)));
        } catch (SymEngineException &) {
        }
    }
    return make_rcp<const RealRoot>(x, n);
}

Expr RealRoot::create(const vec_basic &arguments) const
{
    return realRoot(arguments[0], arguments[1]);
}

Expr RealRoot::diff_impl(const RCP<const Symbol> &variable) const
{
    //(root(x, n))' = root(x, n)/(n x) x'
    const Expr x = get_args()[0];
    const Expr n = get_args()[1];
    return mul(div(rcp_from_this(), mul(n, x)), x->diff(variable));
}

std::complex<double> RealRoot::value(const std::vector<std::complex<double>> &arguments) const
{
    const std::complex<double> x = arguments[0];
    const double n = arguments[1].real();
    if (x.imag() == 0 && x.real() < 0 && n == std::floor(n) && std::fmod(n, 2.0) != 0) return -std::pow(-x.real(), 1.0 / n);
    if (x.imag() == 0 && x.real() >= 0) return std::pow(x.real(), 1.0 / n);
    return std::pow(x, 1.0 / n);
}

}
