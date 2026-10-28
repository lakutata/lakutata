//The special functions that integrals give (see SpecialIntegrals.h)
#include "SpecialIntegrals.h"

#include "../config/boost_math_policy.h"

#include <cmath>
#include <complex>
#include <limits>

#include <boost/math/special_functions/expint.hpp>

#include <symengine/add.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/mul.h>
#include <symengine/nan.h>
#include <symengine/pow.h>
#include <symengine/rational.h>

namespace math {

using namespace SymEngine;

namespace {

using Kind = SpecialIntegral::Kind;
using Complex = std::complex<double>;

constexpr double EULER_GAMMA = 0.57721566490153286061;
constexpr double PI = 3.14159265358979323846;
const double NOT_A_NUMBER = std::numeric_limits<double>::quiet_NaN();

std::string nameOf(Kind kind)
{
    switch (kind) {
        case Kind::Si: return "Si";
        case Kind::Ci: return "Ci";
        case Kind::Shi: return "Shi";
        case Kind::Chi: return "Chi";
        case Kind::Ei: return "Ei";
        case Kind::Li: return "li";
        case Kind::FresnelS: return "fresnelS";
        default: return "fresnelC";
    }
}

bool odd(Kind kind)
{
    return kind == Kind::Si || kind == Kind::Shi || kind == Kind::FresnelS || kind == Kind::FresnelC;
}

//Lentz's method for b0 + a1/(b1 + a2/(b2 + …)) of complex terms
template <typename Terms>
Complex continuedFraction(Complex b0, Terms terms)
{
    const double tiny = 1e-300;
    Complex f = std::abs(b0) == 0 ? Complex(tiny) : b0, c = f, d = 0;
    for (int n = 1; n < 2000; n++) {
        const auto [a, b] = terms(n);
        d = b + a * d;
        if (std::abs(d) == 0) d = tiny;
        d = 1.0 / d;
        c = b + a / c;
        if (std::abs(c) == 0) c = tiny;
        const Complex delta = c * d;
        f *= delta;
        if (std::abs(delta - 1.0) < 1e-16) break;
    }
    return f;
}

//E1(z) = e^-z/(z + 1 - 1/(z + 3 - 4/(z + 5 - …))) (DLMF 6.9.1), for |z| above about 2
Complex e1Fraction(Complex z)
{
    const Complex f = continuedFraction(z + 1.0, [&z](int n) { return std::make_pair(Complex(-static_cast<double>(n) * n), z + static_cast<double>(2 * n + 1)); });
    return std::exp(-z) / f;
}

//erfc(z) = e^(-z^2)/(sqrt(pi)(z + (1/2)/(z + 1/(z + (3/2)/(z + …))))) for Re z > 0 (DLMF 7.9.2), |z| above about 2
Complex erfcFraction(Complex z)
{
    const Complex f = continuedFraction(z, [&z](int n) { return std::make_pair(Complex(n / 2.0), z); });
    return std::exp(-z * z) / (std::sqrt(PI) * f);
}

//Si(t) and Ci(t), t > 0: the power series to 4, then Ci(t) = -Re E1(i t), Si(t) = pi/2 + Im E1(i t) (DLMF 6.5.5)
void sineCosineIntegrals(double t, double &si, double &ci)
{
    if (t <= 4) {
        double p = 1, s = 0, c = 0;
        for (int k = 1; k < 300; k++) {
            p *= t / k;
            const double sign = (k / 2) % 2 == 0 ? 1 : -1, term = sign * p / k;
            if (k % 2 == 1) s += term;
            else c += term;
            if (p / k < 1e-18 * std::max({1.0, std::abs(s), std::abs(c)})) break;
        }
        si = s;
        ci = EULER_GAMMA + std::log(t) + c;
        return;
    }
    const Complex e = e1Fraction({0, t});
    ci = -e.real();
    si = PI / 2 + e.imag();
}

//Shi(t) and Chi(t), t > 0: their power series (positive terms) to 8, then (Ei(t) ± E1(t))/2
void hyperbolicIntegrals(double t, double &shi, double &chi)
{
    if (t <= 8) {
        double p = 1, s = 0, c = 0;
        for (int k = 1; k < 400; k++) {
            p *= t / k;
            if (k % 2 == 1) s += p / k;
            else c += p / k;
            if (p / k < 1e-18 * std::max({1.0, s, c})) break;
        }
        shi = s;
        chi = EULER_GAMMA + std::log(t) + c;
        return;
    }
    const double ei = boost::math::expint(t, lakutata::BoostPolicy()), e1 = boost::math::expint(1, t, lakutata::BoostPolicy());
    shi = (ei + e1) / 2;
    chi = (ei - e1) / 2;
}

//S(x) and C(x), x > 0: their power series to 1.5 (in u = pi x^2/2: C the even powers of u, S the odd ones, x u^j/(j!
//(2j + 1))), then C + i S = (1 + i)/2 erf((1 - i) sqrt(pi) x/2) (DLMF 7.3.22)
void fresnelIntegrals(double x, double &s, double &c)
{
    if (x <= 1.5) {
        const double u = PI * x * x / 2;
        double q = x, sumS = 0, sumC = x;
        for (int j = 1; j < 300; j++) {
            q *= u / j;
            const double term = q / (2 * j + 1);
            if (j % 2 == 1) sumS += ((j - 1) / 2) % 2 == 0 ? term : -term;
            else sumC += (j / 2) % 2 == 0 ? term : -term;
            if (term < 1e-18 * std::max(1.0, std::abs(sumC))) break;
        }
        s = sumS;
        c = sumC;
        return;
    }
    const Complex z = Complex(1, -1) * (std::sqrt(PI) * x / 2);
    const Complex value = Complex(0.5, 0.5) * (1.0 - erfcFraction(z));
    c = value.real();
    s = value.imag();
}

double ei(double x)
{
    if (x == 0) return -std::numeric_limits<double>::infinity();
    return boost::math::expint(x, lakutata::BoostPolicy());
}

}

SpecialIntegral::SpecialIntegral(Kind kind, const Expr &x) : MathFunction(nameOf(kind), x), kind_(kind)
{
}

SpecialIntegral::Kind SpecialIntegral::kind() const
{
    return kind_;
}

Expr SpecialIntegral::create(const vec_basic &arguments) const
{
    return specialIntegralOf(kind_, arguments[0]);
}

Expr SpecialIntegral::diff_impl(const RCP<const Symbol> &variable) const
{
    const Expr x = get_args()[0];
    Expr derivative;
    switch (kind_) {
        case Kind::Si: derivative = div(sin(x), x); break;
        case Kind::Ci: derivative = div(cos(x), x); break;
        case Kind::Shi: derivative = div(sinh(x), x); break;
        case Kind::Chi: derivative = div(cosh(x), x); break;
        case Kind::Ei: derivative = div(exp(x), x); break;
        case Kind::Li: derivative = div(one, log(x)); break;
        case Kind::FresnelS: derivative = sin(div(mul(pi, mul(x, x)), integer(2))); break;
        default: derivative = cos(div(mul(pi, mul(x, x)), integer(2))); break;
    }
    return mul(derivative, x->diff(variable));
}

std::complex<double> SpecialIntegral::value(const std::vector<std::complex<double>> &arguments) const
{
    const Complex z = arguments[0];
    if (z.imag() != 0 || std::isnan(z.real())) return NOT_A_NUMBER;
    const double x = z.real(), t = std::abs(x);
    switch (kind_) {
        case Kind::Si:
        case Kind::Ci: {
            if (t == 0) return kind_ == Kind::Si ? Complex(0) : Complex(-std::numeric_limits<double>::infinity());
            double si, ci;
            sineCosineIntegrals(t, si, ci);
            if (kind_ == Kind::Si) return x < 0 ? -si : si;
            //Ci(-t) = Ci(t) + i pi
            return x < 0 ? Complex(ci, PI) : Complex(ci);
        }
        case Kind::Shi:
        case Kind::Chi: {
            if (t == 0) return kind_ == Kind::Shi ? Complex(0) : Complex(-std::numeric_limits<double>::infinity());
            double shi, chi;
            hyperbolicIntegrals(t, shi, chi);
            if (kind_ == Kind::Shi) return x < 0 ? -shi : shi;
            return x < 0 ? Complex(chi, PI) : Complex(chi);
        }
        case Kind::Ei: return ei(x);
        case Kind::Li: {
            if (x == 0) return 0.0;
            //Of x < 0: Ei(z) of z = ln|x| + i pi, -E1(-z) + i pi (|z| >= pi, where the fraction converges)
            if (x < 0) return -e1Fraction(-Complex(std::log(-x), PI)) + Complex(0, PI);
            return ei(std::log(x));
        }
        default: {
            if (t == 0) return 0.0;
            double s, c;
            fresnelIntegrals(t, s, c);
            const double value = kind_ == Kind::FresnelS ? s : c;
            return x < 0 ? -value : value;
        }
    }
}

std::optional<Expr> specialIntegralSeries(Kind kind, const Expr &u, unsigned order)
{
    if (kind != Kind::Si && kind != Kind::Shi && kind != Kind::FresnelS && kind != Kind::FresnelC) return std::nullopt;
    Expr sum = zero;
    //Si: (-1)^k u^(2k+1)/((2k+1)(2k+1)!), Shi without the signs; fresnelS: (-1)^k (pi/2)^(2k+1) u^(4k+3)/((2k+1)! (4k+3)),
    //fresnelC: (-1)^k (pi/2)^(2k) u^(4k+1)/((2k)! (4k+1))
    for (unsigned k = 0;; k++) {
        const bool fresnel = kind == Kind::FresnelS || kind == Kind::FresnelC;
        const unsigned power = kind == Kind::FresnelS ? 4 * k + 3 : kind == Kind::FresnelC ? 4 * k + 1 : 2 * k + 1;
        if (power > order) break;
        const unsigned factorialOf = kind == Kind::FresnelS ? 2 * k + 1 : kind == Kind::FresnelC ? 2 * k : 2 * k + 1;
        Expr factorial = one;
        for (unsigned j = 2; j <= factorialOf; j++) factorial = mul(factorial, integer(j));
        Expr term = div(pow(u, integer(power)), mul(integer(power), factorial));
        if (fresnel) term = mul(term, pow(div(pi, integer(2)), integer(factorialOf)));
        if (kind != Kind::Shi && k % 2 == 1) term = neg(term);
        sum = add(sum, term);
    }
    return sum;
}

Expr specialIntegralAtInfinity(Kind kind, int sign)
{
    switch (kind) {
        case Kind::Si: return sign > 0 ? div(pi, integer(2)) : neg(div(pi, integer(2)));
        case Kind::Ci: return sign > 0 ? Expr(zero) : Expr();
        case Kind::Shi: return sign > 0 ? Expr(Inf) : Expr(NegInf);
        case Kind::Chi: return sign > 0 ? Expr(Inf) : Expr();
        case Kind::Ei: return sign > 0 ? Expr(Inf) : Expr(zero);
        case Kind::Li: return sign > 0 ? Expr(Inf) : Expr();
        default: return sign > 0 ? Expr(rational(1, 2)) : Expr(rational(-1, 2));
    }
}

Expr specialIntegralOf(Kind kind, const Expr &x)
{
    if (is_a<NaN>(*x)) return Nan;
    if (is_a<Infty>(*x)) {
        const Infty &infinity = down_cast<const Infty &>(*x);
        if (infinity.is_unsigned_infinity()) return Nan;
        const Expr value = specialIntegralAtInfinity(kind, infinity.is_positive_infinity() ? 1 : -1);
        return value.is_null() ? Expr(Nan) : value;
    }
    if (is_a_Number(*x) && down_cast<const Number &>(*x).is_zero()) {
        if (kind == Kind::Ci || kind == Kind::Chi || kind == Kind::Ei) return NegInf;
        return zero;
    }
    if (kind == Kind::Li && eq(*x, *one)) return NegInf;
    //The odd ones of a negative argument: the sign in front
    if (odd(kind)) {
        const bool negative = (is_a_Number(*x) && down_cast<const Number &>(*x).is_negative()) || (is_a<Mul>(*x) && down_cast<const Mul &>(*x).get_coef()->is_negative());
        if (negative) return neg(specialIntegralOf(kind, neg(x)));
    }
    return make_rcp<const SpecialIntegral>(kind, x);
}

Expr siOf(const Expr &x)
{
    return specialIntegralOf(Kind::Si, x);
}

Expr ciOf(const Expr &x)
{
    return specialIntegralOf(Kind::Ci, x);
}

Expr shiOf(const Expr &x)
{
    return specialIntegralOf(Kind::Shi, x);
}

Expr chiOf(const Expr &x)
{
    return specialIntegralOf(Kind::Chi, x);
}

Expr eiOf(const Expr &x)
{
    return specialIntegralOf(Kind::Ei, x);
}

Expr liOf(const Expr &x)
{
    return specialIntegralOf(Kind::Li, x);
}

Expr fresnelSOf(const Expr &x)
{
    return specialIntegralOf(Kind::FresnelS, x);
}

Expr fresnelCOf(const Expr &x)
{
    return specialIntegralOf(Kind::FresnelC, x);
}

}
