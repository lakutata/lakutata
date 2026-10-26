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
#include <symengine/functions.h>
#include <symengine/rational.h>
#include <symengine/complex.h>
#include <symengine/nan.h>
#include <symengine/visitor.h>

namespace math {

using namespace SymEngine;

RCP<const Number> MathFunction::eval(long) const
{
    //The arguments evaluated first: a variable among them fails as SymEngine's evaluations do
    std::vector<std::complex<double>> arguments;
    for (const Expr &argument : get_args()) arguments.push_back(eval_complex_double(*argument));
    //(eval_complex_double gives them without negative zeros)
    const std::complex<double> result = value(arguments);
    if (result.imag() == 0) return real_double(result.real());
    return complex_double(result);
}

double MathFunction::evaluate_real(const double *arguments) const
{
    //An argument without a real value (NaN) gives none: im(sqrt(-2)) is not 0 in the real numbers
    for (size_t i = 0; i < get_args().size(); i++) {
        if (std::isnan(arguments[i])) return std::numeric_limits<double>::quiet_NaN();
    }
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

namespace math {

namespace {

//The value of a variable-free real expression, when it is clearly away from the integers (or from 0 for a sign)
bool clearValue(const Expr &x, double &value)
{
    if (!free_symbols(*x).empty()) return false;
    try {
        const std::complex<double> number = eval_complex_double(*x);
        if (number.imag() != 0 || !std::isfinite(number.real())) return false;
        value = number.real();
        return true;
    } catch (SymEngineException &) {
        return false;
    }
}

bool nearInteger(double value)
{
    return std::abs(value - std::round(value)) <= 1e-10 * std::max(1.0, std::abs(value));
}

//The real and imaginary parts of an exact number
bool numberParts(const Expr &z, Expr &real, Expr &imaginary)
{
    if (is_a<Integer>(*z) || is_a<Rational>(*z)) {
        real = z;
        imaginary = zero;
        return true;
    }
    if (is_a<Complex>(*z)) {
        real = down_cast<const Complex &>(*z).real_part();
        imaginary = down_cast<const Complex &>(*z).imaginary_part();
        return true;
    }
    return false;
}

}

Round::Round(const Expr &x) : MathFunction("round", x)
{
}

Expr roundOf(const Expr &x)
{
    Expr real, imaginary;
    if (numberParts(x, real, imaginary)) {
        //sign(r) floor(|r| + 1/2) for each part
        const auto part = [](const Expr &r) { return mul(sign(r), floor(add(abs(r), rational(1, 2)))); };
        return add(part(real), mul(I, part(imaginary)));
    }
    double value;
    if (clearValue(x, value) && !nearInteger(value - 0.5)) return integer(integer_class(static_cast<long long>(std::round(value))));
    if (is_a<Integer>(*x)) return x;
    return make_rcp<const Round>(x);
}

Expr Round::create(const vec_basic &arguments) const
{
    return roundOf(arguments[0]);
}

Expr Round::diff_impl(const RCP<const Symbol> &) const
{
    //Constant between its jumps
    return zero;
}

std::complex<double> Round::value(const std::vector<std::complex<double>> &arguments) const
{
    return {std::round(arguments[0].real()), std::round(arguments[0].imag())};
}

Mod::Mod(const Expr &a, const Expr &b) : MathFunction("mod", vec_basic{a, b})
{
}

Expr modOf(const Expr &a, const Expr &b)
{
    if (is_a_Number(*b) && down_cast<const Number &>(*b).is_zero()) return Nan;
    //Exact for real numbers: a - b floor(a/b)
    if ((is_a<Integer>(*a) || is_a<Rational>(*a)) && (is_a<Integer>(*b) || is_a<Rational>(*b))) return sub(a, mul(b, floor(div(a, b))));
    double numerator, denominator;
    if (clearValue(a, numerator) && clearValue(b, denominator) && denominator != 0 && !nearInteger(numerator / denominator)) {
        return sub(a, mul(b, integer(integer_class(static_cast<long long>(std::floor(numerator / denominator))))));
    }
    return make_rcp<const Mod>(a, b);
}

Expr Mod::create(const vec_basic &arguments) const
{
    return modOf(arguments[0], arguments[1]);
}

Expr Mod::diff_impl(const RCP<const Symbol> &variable) const
{
    //a' - b' floor(a/b): the floor is constant between its jumps
    const Expr a = get_args()[0];
    const Expr b = get_args()[1];
    return sub(a->diff(variable), mul(b->diff(variable), floor(div(a, b))));
}

std::complex<double> Mod::value(const std::vector<std::complex<double>> &arguments) const
{
    const std::complex<double> a = arguments[0];
    const std::complex<double> b = arguments[1];
    if (a.imag() != 0 || b.imag() != 0 || b.real() == 0) return std::numeric_limits<double>::quiet_NaN();
    return a.real() - b.real() * std::floor(a.real() / b.real());
}

Sinc::Sinc(const Expr &x) : MathFunction("sinc", x)
{
}

Expr sincOf(const Expr &x)
{
    if (is_a_Number(*x) && down_cast<const Number &>(*x).is_zero()) return one;
    if (is_a_Number(*x) || free_symbols(*x).empty()) return div(sin(x), x);
    return make_rcp<const Sinc>(x);
}

Expr Sinc::create(const vec_basic &arguments) const
{
    return sincOf(arguments[0]);
}

Expr Sinc::diff_impl(const RCP<const Symbol> &variable) const
{
    //(cos(x)/x - sin(x)/x^2) x'
    const Expr x = get_args()[0];
    return mul(sub(div(cos(x), x), div(sin(x), pow(x, integer(2)))), x->diff(variable));
}

std::complex<double> Sinc::value(const std::vector<std::complex<double>> &arguments) const
{
    const std::complex<double> x = arguments[0];
    if (std::abs(x) < 1e-8) return 1.0 - x * x / 6.0;
    return std::sin(x) / x;
}

ComplexPart::ComplexPart(Part part, const Expr &z)
    : MathFunction(part == Part::Real ? "re" : part == Part::Imaginary ? "im" : "arg", z), part_(part)
{
}

namespace {

//The real and imaginary parts of an expression where they are known: exact numbers, real constants, sums of them,
//products by real or imaginary numbers
bool knownParts(const Expr &z, Expr &real, Expr &imaginary)
{
    if (numberParts(z, real, imaginary)) return true;
    if (is_a<Constant>(*z)) {
        real = z;
        imaginary = zero;
        return true;
    }
    if (free_symbols(*z).empty() && is_true(is_real(*z))) {
        real = z;
        imaginary = zero;
        return true;
    }
    //What SymEngine does not tell real: the logarithm of a positive number (ln(2)), a positive number to a real power
    double value;
    if (is_a<Log>(*z) && clearValue(z->get_args()[0], value) && value > 0) {
        real = z;
        imaginary = zero;
        return true;
    }
    if (is_a<Pow>(*z) && clearValue(down_cast<const Pow &>(*z).get_base(), value) && value > 0
        && free_symbols(*down_cast<const Pow &>(*z).get_exp()).empty() && is_true(is_real(*down_cast<const Pow &>(*z).get_exp()))) {
        real = z;
        imaginary = zero;
        return true;
    }
    return false;
}

//re(), im(), arg() and abs() are real: re(re(x)) is re(x), im(abs(x)) is 0
bool realFunction(const Expr &z)
{
    return dynamic_cast<const ComplexPart *>(z.get()) != nullptr || is_a<Abs>(*z);
}

}

bool constantParts(const Expr &z, Expr &real, Expr &imaginary)
{
    if (knownParts(z, real, imaginary)) return true;
    if (!free_symbols(*z).empty()) return false;
    if (is_a<Add>(*z) || is_a<Mul>(*z)) {
        const bool sum = is_a<Add>(*z);
        real = sum ? zero : one;
        imaginary = zero;
        for (const Expr &part : z->get_args()) {
            Expr a, b;
            if (!constantParts(part, a, b)) return false;
            if (sum) {
                real = add(real, a);
                imaginary = add(imaginary, b);
            } else {
                const Expr next = sub(mul(real, a), mul(imaginary, b));
                imaginary = add(mul(real, b), mul(imaginary, a));
                real = next;
            }
        }
        return true;
    }
    if (is_a<Pow>(*z) && eq(*down_cast<const Pow &>(*z).get_base(), *E)) {
        Expr a, b;
        if (!constantParts(down_cast<const Pow &>(*z).get_exp(), a, b)) return false;
        real = mul(exp(a), cos(b));
        imaginary = mul(exp(a), sin(b));
        return true;
    }
    return false;
}

namespace {

//A product c u, c the factors without variables (of known parts c = real + i imaginary), u the others
bool constantFactor(const Mul &product, Expr &real, Expr &imaginary, Expr &rest)
{
    Expr constant = product.get_coef();
    Expr others = one;
    for (const auto &[base, exponent] : product.get_dict()) {
        const Expr factor = pow(base, exponent);
        if (free_symbols(*factor).empty()) constant = mul(constant, factor);
        else others = mul(others, factor);
    }
    if (eq(*constant, *one) || eq(*others, *one)) return false;
    rest = others;
    return constantParts(constant, real, imaginary);
}

}

Expr realPartOf(const Expr &z)
{
    Expr real, imaginary;
    if (realFunction(z)) return z;
    if (constantParts(z, real, imaginary)) return real;
    if (is_a<Add>(*z)) {
        Expr sum = zero;
        for (const Expr &term : z->get_args()) sum = add(sum, realPartOf(term));
        return sum;
    }
    if (is_a<Mul>(*z)) {
        //A constant c = a + bi (the factors without variables, of known parts): re(c u) = a re(u) - b im(u)
        Expr rest;
        if (constantFactor(down_cast<const Mul &>(*z), real, imaginary, rest)) {
            return sub(mul(real, realPartOf(rest)), mul(imaginary, imaginaryPartOf(rest)));
        }
    }
    //re(e^w) = e^re(w) cos(im(w)), for every complex w
    if (is_a<Pow>(*z) && eq(*down_cast<const Pow &>(*z).get_base(), *E)) {
        const Expr w = down_cast<const Pow &>(*z).get_exp();
        return mul(exp(realPartOf(w)), cos(imaginaryPartOf(w)));
    }
    return make_rcp<const ComplexPart>(ComplexPart::Part::Real, z);
}

Expr imaginaryPartOf(const Expr &z)
{
    Expr real, imaginary;
    if (realFunction(z)) return zero;
    if (constantParts(z, real, imaginary)) return imaginary;
    if (is_a<Add>(*z)) {
        Expr sum = zero;
        for (const Expr &term : z->get_args()) sum = add(sum, imaginaryPartOf(term));
        return sum;
    }
    if (is_a<Mul>(*z)) {
        //im(c u) = a im(u) + b re(u)
        Expr rest;
        if (constantFactor(down_cast<const Mul &>(*z), real, imaginary, rest)) {
            return add(mul(real, imaginaryPartOf(rest)), mul(imaginary, realPartOf(rest)));
        }
    }
    //im(e^w) = e^re(w) sin(im(w))
    if (is_a<Pow>(*z) && eq(*down_cast<const Pow &>(*z).get_base(), *E)) {
        const Expr w = down_cast<const Pow &>(*z).get_exp();
        return mul(exp(realPartOf(w)), sin(imaginaryPartOf(w)));
    }
    return make_rcp<const ComplexPart>(ComplexPart::Part::Imaginary, z);
}

Expr argumentOf(const Expr &z)
{
    Expr real, imaginary;
    if (constantParts(z, real, imaginary)) {
        if (is_a_Number(*real) && is_a_Number(*imaginary) && down_cast<const Number &>(*real).is_zero() && down_cast<const Number &>(*imaginary).is_zero()) return Nan;
        if (is_a_Number(*imaginary) && down_cast<const Number &>(*imaginary).is_zero()) {
            double value;
            if (clearValue(real, value)) return value > 0 ? Expr(zero) : Expr(pi);
        }
        //Right of the imaginary axis: atan(b/a) (arg(3 + 4i) is atan(4/3))
        double value;
        if (clearValue(real, value) && value > 0) return atan(div(imaginary, real));
        return atan2(imaginary, real);
    }
    return make_rcp<const ComplexPart>(ComplexPart::Part::Argument, z);
}

Expr ComplexPart::create(const vec_basic &arguments) const
{
    return part_ == Part::Real ? realPartOf(arguments[0]) : part_ == Part::Imaginary ? imaginaryPartOf(arguments[0]) : argumentOf(arguments[0]);
}

Expr ComplexPart::diff_impl(const RCP<const Symbol> &variable) const
{
    //Along the real line: re(u)' = re(u'), im(u)' = im(u'), arg(u)' = im(u'/u)
    const Expr u = get_args()[0];
    const Expr derivative = u->diff(variable);
    if (part_ == Part::Real) return realPartOf(derivative);
    if (part_ == Part::Imaginary) return imaginaryPartOf(derivative);
    return imaginaryPartOf(div(derivative, u));
}

std::complex<double> ComplexPart::value(const std::vector<std::complex<double>> &arguments) const
{
    const std::complex<double> z = arguments[0];
    if (part_ == Part::Real) return z.real();
    if (part_ == Part::Imaginary) return z.imag();
    if (z == 0.0) return std::numeric_limits<double>::quiet_NaN();
    //A negative real number on the upper side of the cut: arg(-2) is pi
    return std::atan2(z.imag() + 0.0, z.real());
}

}
