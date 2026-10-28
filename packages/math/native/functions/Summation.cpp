//The sums and the products of the formulas (see Summation.h)
#include "Summation.h"

#include <limits>
#include <map>
#include <optional>
#include <vector>

#include <symengine/add.h>
#include <symengine/complex_double.h>
#include <symengine/eval_double.h>
#include <symengine/real_double.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/logic.h>
#include <symengine/mul.h>
#include <symengine/polys/basic_conversions.h>
#include <symengine/polys/uexprpoly.h>
#include <symengine/pow.h>
#include <symengine/rational.h>
#include <symengine/subs.h>
#include <symengine/visitor.h>

#include "../async/Pool.h"
#include "Gosper.h"
#include "../core/Errors.h"
#include "../limits/Gruntz.h"
#include "../ops/Operations.h"
#include "../ops/Piecewise.h"
#include "../poly/Poly.h"
#include "../poly/Rational.h"
#include "../printer/Printer.h"

namespace math {

using namespace SymEngine;

namespace {

//Limits of integers at most this many apart: the terms computed one by one, the sum exact at once
constexpr long DIRECT = 1000;
//For a value only, at most this many
constexpr long WRITTEN = 10000;

bool has(const Expr &e, const RCP<const Symbol> &k)
{
    return has_symbol(*e, *k);
}

std::optional<integer_class> integerOf(const Expr &e)
{
    if (is_a<Integer>(*e)) return down_cast<const Integer &>(*e).as_integer_class();
    return std::nullopt;
}

bool positiveInfinity(const Expr &e)
{
    return is_a<Infty>(*e) && down_cast<const Infty &>(*e).is_positive_infinity();
}

bool negativeInfinity(const Expr &e)
{
    return is_a<Infty>(*e) && down_cast<const Infty &>(*e).is_negative_infinity();
}

//The limits: integers, -inf, inf or expressions of other variables
void checkLimits(const std::string &name, const Expr &low, const Expr &high)
{
    for (const Expr &limit : {low, high}) {
        const bool infinite = positiveInfinity(limit) || negativeInfinity(limit);
        if ((is_a_Number(*limit) && !is_a<Integer>(*limit) && !infinite) || is_a<NaN>(*limit)) {
            throw MathError(ErrorCode::Argument, "The limits of " + name + " are integers, -inf or inf: " + toText(limit) + " is not one");
        }
    }
    if (positiveInfinity(low) || negativeInfinity(high)) throw MathError(ErrorCode::Argument, "The first value of " + name + " cannot be inf, nor its last one -inf");
}

//A fraction factored where it is one of polynomials (6/((n + 2)(n + 3)), (n + 1)/(2n), not (n/2 + 1/2)/n)
Expr simplestOf(const Expr &value)
{
    try {
        const std::pair<Expr, Expr> fraction = fractionOf(value);
        return factoredFraction(fraction.first, fraction.second);
    } catch (const MathError &error) {
        if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        return value;
    }
}

Expr call(const std::string &name, const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    return make_rcp<const Summation>(name, term, k, low, high);
}

//The term at a value of its variable
Expr at(const Expr &term, const RCP<const Symbol> &k, const Expr &value)
{
    map_basic_basic replacement;
    replacement[k] = value;
    return subs(term, replacement);
}

//The number of terms from low to high
Expr countOf(const Expr &low, const Expr &high)
{
    return add(sub(high, low), one);
}

//The coefficients of a term as a polynomial in k, from the constant term up (of degree 200 at most)
std::optional<std::vector<Expr>> polynomialIn(const Expr &term, const RCP<const Symbol> &k)
{
    try {
        const RCP<const UExprPoly> polynomial = from_basic<UExprPoly>(expand(term), k);
        std::vector<Expr> coefficients;
        for (const auto &[power, coefficient] : polynomial->get_poly().get_dict()) {
            if (power < 0 || power > 200 || has(coefficient.get_basic(), k)) return std::nullopt;
            if (static_cast<size_t>(power) >= coefficients.size()) coefficients.resize(static_cast<size_t>(power) + 1, zero);
            coefficients[static_cast<size_t>(power)] = coefficient.get_basic();
        }
        if (coefficients.empty()) coefficients.push_back(zero);
        return coefficients;
    } catch (SymEngineException &) {
        return std::nullopt;
    }
}

//The falling factorial n(n - 1)…(n - j + 1)
Expr falling(const Expr &n, long j)
{
    Expr product = one;
    for (long i = 0; i < j; i++) product = mul(product, sub(n, integer(i)));
    return product;
}

//The sum of a polynomial from low to high: F(high + 1) - F(low), where F(n), the sum from 0 to n - 1, comes from the
//falling factorials (k^m is the sum of S(m, j) k^(j), S the Stirling numbers of the second kind, and the sum of k^(j)
//from 0 to n - 1 is n^(j+1)/(j + 1))
Expr polynomialSum(const std::vector<Expr> &c, const Expr &low, const Expr &high)
{
    const size_t d = c.size() - 1;
    std::vector<std::vector<integer_class>> stirling(d + 1, std::vector<integer_class>(d + 1, integer_class(0)));
    stirling[0][0] = 1;
    for (size_t m = 1; m <= d; m++) {
        for (size_t j = 1; j <= m; j++) stirling[m][j] = integer_class(static_cast<long>(j)) * stirling[m - 1][j] + stirling[m - 1][j - 1];
    }
    const auto antidifference = [&](const Expr &n) {
        Expr total = zero;
        for (size_t m = 0; m <= d; m++) {
            if (is_a_Number(*c[m]) && down_cast<const Number &>(*c[m]).is_zero()) continue;
            Expr inner = zero;
            for (size_t j = 0; j <= m; j++) {
                if (stirling[m][j] == 0) continue;
                inner = add(inner, mul(div(integer(stirling[m][j]), integer(static_cast<long>(j) + 1)), falling(n, static_cast<long>(j) + 1)));
            }
            total = add(total, mul(c[m], inner));
        }
        return total;
    };
    return expand(sub(antidifference(add(high, one)), antidifference(low)));
}

//The factors of a term: its bases and their exponents, with its number
void factorsOf(const Expr &term, RCP<const Number> &number, std::vector<std::pair<Expr, Expr>> &factors)
{
    number = one;
    if (is_a<Mul>(*term)) {
        number = down_cast<const Mul &>(*term).get_coef();
        for (const auto &[base, exponent] : down_cast<const Mul &>(*term).get_dict()) factors.emplace_back(base, exponent);
    } else if (is_a<Pow>(*term)) {
        factors.emplace_back(down_cast<const Pow &>(*term).get_base(), down_cast<const Pow &>(*term).get_exp());
    } else if (is_a_Number(*term)) {
        number = rcp_static_cast<const Number>(term);
    } else {
        factors.emplace_back(term, one);
    }
}

//A geometric sum, of c r^k (the factors of the term without k, and those of bases without k to exponents linear in
//k): c (r^low - r^(high + 1))/(1 - r), c(high - low + 1) where r = 1; to inf where |r| < 1, c r^low/(1 - r)
std::optional<Expr> geometricSum(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    RCP<const Number> number;
    std::vector<std::pair<Expr, Expr>> factors;
    factorsOf(term, number, factors);
    Expr c = number, r = one;
    for (const auto &[base, exponent] : factors) {
        if (has(base, k)) return std::nullopt;
        if (!has(exponent, k)) {
            c = mul(c, pow(base, exponent));
            continue;
        }
        const std::optional<std::vector<Expr>> linear = polynomialIn(exponent, k);
        if (!linear || linear->size() != 2) return std::nullopt;
        r = mul(r, pow(base, (*linear)[1]));
        c = mul(c, pow(base, (*linear)[0]));
    }
    if (eq(*r, *one)) return std::nullopt;
    if (negativeInfinity(low)) return std::nullopt;
    if (positiveInfinity(high)) {
        const Expr limit = div(mul(c, pow(r, low)), sub(one, r));
        const RCP<const Boolean> converges = relationOf("<", abs(r), one);
        const int known = decidedOf(converges);
        if (known == 1) return limit;
        //Without end for r > 1: an infinity of the sign of c (for r <= -1 the partial sums oscillate)
        if (known == 0) {
            const int growing = compareOf(r, one), s = compareOf(c, zero);
            if (growing == 1 && (s == 1 || s == -1)) return s > 0 ? Expr(Inf) : Expr(NegInf);
            return std::nullopt;
        }
        return SymEngine::piecewise({{limit, converges}, {call("sum", term, k, low, high), boolTrue}});
    }
    const Expr total = div(mul(c, sub(pow(r, low), pow(r, add(high, one)))), sub(one, r));
    const RCP<const Boolean> unit = relationOf("=", r, one);
    if (decidedOf(unit) == 0) return total;
    return SymEngine::piecewise({{mul(c, countOf(low, high)), unit}, {total, boolTrue}});
}

//The sum of c/(αk + β)^s, s a positive number, q = β/α: digamma(high + q + 1) - digamma(low + q) for s = 1; for s > 1
//by Hurwitz's zeta, zeta(s, low + q) - zeta(s, high + q + 1), zeta(s, low + q) to inf (zeta(3) - zeta(3, n + 1))
//Hurwitz's zeta, Riemann's at 1 (zeta(3), not zeta(3, 1))
Expr hurwitz(const Expr &s, const Expr &a)
{
    return eq(*a, *one) ? zeta(s) : zeta(s, a);
}

std::optional<Expr> reciprocalPowerSum(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    RCP<const Number> number;
    std::vector<std::pair<Expr, Expr>> factors;
    factorsOf(term, number, factors);
    Expr c = number, base, power;
    for (const auto &[b, e] : factors) {
        if (!has(b, k) && !has(e, k)) {
            c = mul(c, pow(b, e));
        } else if (base.is_null() && !has(e, k) && is_a_Number(*e) && down_cast<const Number &>(*e).is_negative()) {
            base = b;
            power = neg(e);
        } else {
            return std::nullopt;
        }
    }
    if (base.is_null() || negativeInfinity(low)) return std::nullopt;
    const std::optional<std::vector<Expr>> linear = polynomialIn(base, k);
    if (!linear || linear->size() != 2 || !is_a_Number(*(*linear)[1]) || !down_cast<const Number &>(*(*linear)[1]).is_positive()) return std::nullopt;
    const Expr alpha = (*linear)[1], q = div((*linear)[0], alpha);
    c = mul(c, pow(alpha, neg(power)));
    const bool converging = down_cast<const Number &>(*sub(power, one)).is_positive();
    if (positiveInfinity(high)) {
        //1/k, 1/sqrt(k)… to inf: without end
        if (!converging) return is_a_Number(*c) && down_cast<const Number &>(*c).is_positive() ? std::optional<Expr>(Inf) : std::nullopt;
        return mul(c, hurwitz(power, add(low, q)));
    }
    //1/(k + q): digamma(high + q + 1) - digamma(low + q)
    if (eq(*power, *one)) return mul(c, sub(polygamma(zero, add(add(high, q), one)), polygamma(zero, add(low, q))));
    if (!converging) return std::nullopt;
    return mul(c, sub(hurwitz(power, add(low, q)), hurwitz(power, add(add(high, q), one))));
}

std::optional<Expr> closedSum(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high);

//The sum by Gosper's algorithm; where the term has a geometric ratio r of other variables (x^k), the sum where r = 1 in
//a piecewise expression, as for a geometric series (the formula for k x^k has a pole at x = 1)
std::optional<Expr> hypergeometricSum(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    //To inf: the limit of the sum to n (where it is found; a ratio of other variables is left to the call)
    if (positiveInfinity(high)) {
        if (negativeInfinity(low)) return std::nullopt;
        const RCP<const Symbol> n = symbol("@high");
        const std::optional<Expr> partial = gosperSum(term, k, low, n);
        if (!partial) return std::nullopt;
        try {
            return limitOf(*partial, n, Inf, "+");
        } catch (const MathError &error) {
            if (error.code() != ErrorCode::NotSupported && error.code() != ErrorCode::Domain) throw;
            return std::nullopt;
        }
    }
    const std::optional<Expr> sum = gosperSum(term, k, low, high);
    if (!sum) return std::nullopt;
    RCP<const Number> number;
    std::vector<std::pair<Expr, Expr>> factors;
    factorsOf(term, number, factors);
    Expr ratio = one, atOne = number;
    for (const auto &[base, exponent] : factors) {
        if (!has(base, k) && has(exponent, k)) {
            const std::optional<std::vector<Expr>> linear = polynomialIn(exponent, k);
            if (!linear || linear->size() != 2) return sum;
            ratio = mul(ratio, pow(base, (*linear)[1]));
            atOne = mul(atOne, pow(base, (*linear)[0]));
        } else {
            atOne = mul(atOne, pow(base, exponent));
        }
    }
    const RCP<const Boolean> unit = relationOf("=", ratio, one);
    if (eq(*ratio, *one) || decidedOf(unit) == 0) return sum;
    const std::optional<Expr> whereOne = closedSum(atOne, k, low, high);
    if (!whereOne) return sum;
    return SymEngine::piecewise({{*whereOne, unit}, {*sum, boolTrue}});
}

//The sum of a term times the factors without k: those factors times the sum of the rest
std::optional<Expr> scaledSum(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    if (!is_a<Mul>(*term)) return std::nullopt;
    RCP<const Number> number;
    std::vector<std::pair<Expr, Expr>> factors;
    factorsOf(term, number, factors);
    Expr outside = number, inside = one;
    for (const auto &[base, exponent] : factors) {
        if (has(base, k) || has(exponent, k)) inside = mul(inside, pow(base, exponent));
        else outside = mul(outside, pow(base, exponent));
    }
    if (eq(*outside, *one)) return std::nullopt;
    const std::optional<Expr> sum = closedSum(inside, k, low, high);
    if (!sum) return std::nullopt;
    return mul(outside, *sum);
}

std::optional<Expr> closedSum(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    checkpoint();
    if (!has(term, k)) return mul(term, countOf(low, high));
    if (const std::optional<Expr> scaled = scaledSum(term, k, low, high)) return scaled;
    if (const std::optional<std::vector<Expr>> c = polynomialIn(term, k)) {
        if (negativeInfinity(low)) return std::nullopt;
        if (positiveInfinity(high)) {
            //Without end: an infinity of the sign of the leading coefficient
            const Expr &lead = c->back();
            if (is_a<Integer>(*lead) || is_a<Rational>(*lead)) return down_cast<const Number &>(*lead).is_positive() ? Expr(Inf) : Expr(NegInf);
            return std::nullopt;
        }
        return polynomialSum(*c, low, high);
    }
    if (const std::optional<Expr> geometric = geometricSum(term, k, low, high)) return geometric;
    if (const std::optional<Expr> reciprocal = reciprocalPowerSum(term, k, low, high)) return reciprocal;
    if (const std::optional<Expr> hypergeometric = hypergeometricSum(term, k, low, high)) return hypergeometric;
    return std::nullopt;
}

//The integer below a rational number
integer_class floorOf(const rational_class &value)
{
    integer_class whole;
    mp_fdiv_q(whole, get_num(value), get_den(value));
    return whole;
}

std::optional<Expr> fractionProduct(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high);

std::optional<Expr> closedProduct(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    checkpoint();
    if (!has(term, k)) return pow(term, countOf(low, high));
    if (positiveInfinity(high) || negativeInfinity(low)) return std::nullopt;
    if (const std::optional<Expr> fraction = fractionProduct(term, k, low, high)) return fraction;
    if (is_a<Mul>(*term)) {
        RCP<const Number> number;
        std::vector<std::pair<Expr, Expr>> factors;
        factorsOf(term, number, factors);
        Expr product = pow(number, countOf(low, high));
        for (const auto &[base, exponent] : factors) {
            const std::optional<Expr> part = closedProduct(pow(base, exponent), k, low, high);
            if (!part) return std::nullopt;
            product = mul(product, *part);
        }
        return product;
    }
    if (is_a<Pow>(*term)) {
        const Expr base = down_cast<const Pow &>(*term).get_base(), exponent = down_cast<const Pow &>(*term).get_exp();
        if (!has(base, k)) return pow(base, summationOf(exponent, k, low, high));
        if (!is_a<Integer>(*exponent)) return std::nullopt;
        const std::optional<Expr> product = closedProduct(base, k, low, high);
        if (!product) return std::nullopt;
        return pow(*product, exponent);
    }
    return std::nullopt;
}

//The product of a fraction of polynomials of rational coefficients from low to high, of their linear factors α(k + c):
//α^count times gamma(high + c + 1)/gamma(low + c) for each, the gammas of arguments an integer apart written as one
//gamma times the factors between them (gamma(n + 2) is gamma(n) n (n + 1)), so that those whose powers add up to 0
//leave a fraction: the product of 1 - 1/k^2 from 2 to n is (n + 1)/(2n)
std::optional<Expr> fractionProduct(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    if (positiveInfinity(high) || negativeInfinity(low)) return std::nullopt;
    const std::pair<Expr, Expr> fraction = fractionOf(term);
    Expr coefficient = one;
    std::vector<std::pair<rational_class, long>> shifts;
    for (const auto &[part, sign] : {std::pair<Expr, long>{fraction.first, 1}, std::pair<Expr, long>{fraction.second, -1}}) {
        const std::optional<std::vector<Expr>> c = polynomialIn(part, k);
        if (!c) return std::nullopt;
        for (const Expr &value : *c) {
            if (!is_a<Integer>(*value) && !is_a<Rational>(*value)) return std::nullopt;
        }
        if (!has(part, k)) {
            coefficient = mul(coefficient, pow(part, integer(sign)));
            continue;
        }
        const FactoredPolynomial factored = factorPolynomial(part);
        coefficient = mul(coefficient, pow(factored.coefficient, integer(sign)));
        for (const auto &[factor, multiplicity] : factored.factors) {
            const std::optional<std::vector<Expr>> linear = polynomialIn(factor, k);
            if (!linear || linear->size() != 2) return std::nullopt;
            const Expr alpha = (*linear)[1], shift = div((*linear)[0], alpha);
            coefficient = mul(coefficient, pow(alpha, integer(sign * multiplicity)));
            //A factor that is 0 inside the range: a product of 0 (in the numerator) or without a value; where that
            //depends on the limits, no closed form
            const Expr first = add(low, shift), last = add(high, shift);
            if (!is_a<Integer>(*first) && is_a_Number(*first)) {
                //Never an integer: never 0
            } else if (!is_a<Integer>(*first) || !down_cast<const Integer &>(*first).is_positive()) {
                if (is_a<Integer>(*first) && is_a<Integer>(*last) && !down_cast<const Integer &>(*last).is_negative() && sign > 0) return zero;
                return std::nullopt;
            }
            const rational_class value = is_a<Integer>(*shift) ? rational_class(down_cast<const Integer &>(*shift).as_integer_class()) : down_cast<const Rational &>(*shift).as_rational_class();
            shifts.emplace_back(value, sign * multiplicity);
        }
    }
    Expr product = pow(coefficient, countOf(low, high));
    //gamma(end + c)^e: by the fractional part of c, one gamma at the lowest c and the factors up to each other c
    for (const auto &[end, sign] : {std::pair<Expr, long>{add(high, one), 1}, std::pair<Expr, long>{low, -1}}) {
        std::map<rational_class, std::vector<std::pair<rational_class, long>>> groups;
        for (const auto &[c, power] : shifts) {
            const integer_class whole = floorOf(c);
            groups[c - rational_class(whole)].emplace_back(c, power);
        }
        for (const auto &[fraction, members] : groups) {
            rational_class lowest = members.front().first;
            long total = 0;
            for (const auto &[c, power] : members) {
                lowest = std::min(lowest, c);
                total += power;
            }
            const Expr start = add(end, Rational::from_mpq(lowest));
            product = mul(product, pow(gamma(start), integer(sign * total)));
            for (const auto &[c, power] : members) {
                const integer_class steps = floorOf(c - lowest);
                for (integer_class j = 0; j < steps; j++) product = mul(product, pow(add(start, integer(j)), integer(sign * power)));
            }
        }
    }
    return product;
}

}

Summation::Summation(const std::string &name, const Expr &term, const Expr &index, const Expr &low, const Expr &high)
    : MathFunction(name, vec_basic{term, index, low, high})
{
}

bool Summation::isSum() const
{
    return get_name() == "sum";
}

Expr Summation::create(const vec_basic &arguments) const
{
    if (!is_a_sub<Symbol>(*arguments[1])) throw MathError(ErrorCode::Internal, "The variable of " + get_name() + " is not a variable");
    const RCP<const Symbol> k = rcp_static_cast<const Symbol>(arguments[1]);
    return isSum() ? summationOf(arguments[0], k, arguments[2], arguments[3]) : iteratedProductOf(arguments[0], k, arguments[2], arguments[3]);
}

Expr Summation::diff_impl(const RCP<const Symbol> &variable) const
{
    const vec_basic arguments = get_args();
    //Limits with the variable: not derived
    if (has_symbol(*arguments[2], *variable) || has_symbol(*arguments[3], *variable)) return Derivative::create(rcp_from_this(), {variable});
    const RCP<const Symbol> k = rcp_static_cast<const Symbol>(arguments[1]);
    const Expr derivative = arguments[0]->diff(variable);
    if (isSum()) return summationOf(derivative, k, arguments[2], arguments[3]);
    //(Π f)' = Π f · Σ f'/f
    return mul(rcp_from_this(), summationOf(div(derivative, arguments[0]), k, arguments[2], arguments[3]));
}

std::complex<double> Summation::value(const std::vector<std::complex<double>> &) const
{
    return {std::numeric_limits<double>::quiet_NaN(), 0};
}

RCP<const Number> Summation::eval(long) const
{
    //Between integers: the value of its terms written out
    const std::complex<double> value = eval_complex_double(*writtenOut(*this));
    if (value.imag() == 0) return real_double(value.real());
    return complex_double(value);
}

Expr summationOf(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    checkLimits("sum", low, high);
    const std::optional<integer_class> a = integerOf(low), b = integerOf(high);
    if (a && b) {
        if (*b == *a - 1) return zero;
        if (*b < *a - 1) return neg(summationOf(term, k, add(high, one), sub(low, one)));
        if (*b - *a + 1 <= DIRECT) {
            Expr total = zero;
            for (integer_class i = *a; i <= *b; i++) total = add(total, at(term, k, integer(i)));
            return total;
        }
    }
    if (const std::optional<Expr> closed = closedSum(term, k, low, high)) return *closed;
    //A sum of terms: the sums of those with a closed form apart
    if (is_a<Add>(*term)) {
        Expr found = zero, rest = zero;
        bool any = false;
        for (const Expr &part : term->get_args()) {
            const std::optional<Expr> sum = closedSum(part, k, low, high);
            if (sum) {
                found = add(found, *sum);
                any = true;
            } else {
                rest = add(rest, part);
            }
        }
        if (any) return eq(*rest, *zero) ? found : add(found, call("sum", rest, k, low, high));
    }
    return call("sum", term, k, low, high);
}

Expr iteratedProductOf(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    checkLimits("product", low, high);
    const std::optional<integer_class> a = integerOf(low), b = integerOf(high);
    if (a && b) {
        if (*b == *a - 1) return one;
        if (*b < *a - 1) return div(one, iteratedProductOf(term, k, add(high, one), sub(low, one)));
        if (*b - *a + 1 <= DIRECT) {
            Expr total = one;
            for (integer_class i = *a; i <= *b; i++) total = mul(total, at(term, k, integer(i)));
            return total;
        }
    }
    if (const std::optional<Expr> closed = closedProduct(term, k, low, high)) return simplestOf(*closed);
    return call("product", term, k, low, high);
}

Expr writtenOut(const Basic &node)
{
    const Summation &series = down_cast<const Summation &>(node);
    const vec_basic arguments = series.get_args();
    const std::optional<integer_class> a = integerOf(arguments[2]), b = integerOf(arguments[3]);
    const std::string text = toText(node.rcp_from_this());
    if (!a || !b) throw MathError(ErrorCode::NotSupported, "No closed form is found for " + text + ": its value is computed term by term between integers only");
    if (*b - *a + 1 > WRITTEN) throw MathError(ErrorCode::NotSupported, "No closed form is found for " + text + ": its value is computed term by term, of 10^4 terms at most");
    const RCP<const Symbol> k = rcp_static_cast<const Symbol>(arguments[1]);
    Expr total = series.isSum() ? zero : one;
    for (integer_class i = *a; i <= *b; i++) {
        if (i % 256 == 0) checkpoint();
        const Expr term = at(arguments[0], k, integer(i));
        total = series.isSum() ? add(total, term) : mul(total, term);
    }
    return total;
}

}
