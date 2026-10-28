//Gosper's algorithm (see Gosper.h)
#include "Gosper.h"

#include <algorithm>
#include <cstdlib>
#include <set>
#include <string>
#include <vector>

#include <symengine/add.h>
#include <symengine/constants.h>
#include <symengine/functions.h>
#include <symengine/infinity.h>
#include <symengine/integer.h>
#include <symengine/mul.h>
#include <symengine/nan.h>
#include <symengine/pow.h>
#include <symengine/subs.h>
#include <symengine/visitor.h>

#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../ops/Operations.h"
#include "../poly/Poly.h"
#include "../poly/Rational.h"

namespace math {

using namespace SymEngine;

namespace {

//The polynomials in n, with the other variables as parameters: their coefficients, gcd, quotients, shifts, by the
//operations of math.poly on expressions
struct Polynomials {
    RCP<const Symbol> n;

    std::vector<Expr> coefficients(const Expr &p) const
    {
        return coefficientsOf(p, n->get_name());
    }

    long degree(const Expr &p) const
    {
        return static_cast<long>(coefficients(p).size()) - 1;
    }

    //(0 for the zero polynomial, which has no coefficients)
    Expr lead(const Expr &p) const
    {
        const std::vector<Expr> c = coefficients(p);
        return c.empty() ? Expr(zero) : c.back();
    }

    //The coefficient of n^i
    Expr nth(const Expr &p, long i) const
    {
        const std::vector<Expr> c = coefficients(p);
        return i >= 0 && static_cast<size_t>(i) < c.size() ? c[static_cast<size_t>(i)] : Expr(zero);
    }

    Expr shift(const Expr &p, const Expr &by) const
    {
        map_basic_basic shifted;
        shifted[n] = add(n, by);
        return expand(subs(p, shifted));
    }

    Expr monic(const Expr &p) const
    {
        return expand(cancelOf(div(p, lead(p))));
    }

    //The gcd over the fractions of the parameters: the gcd of the polynomials without its content in n
    Expr gcd(const Expr &a, const Expr &b) const
    {
        const Expr g = polyOperation("gcd", {a, b}, {}).expression;
        return monic(g);
    }

    Expr quotient(const Expr &a, const Expr &b) const
    {
        return expand(cancelOf(div(a, b)));
    }
};

//The ratio f(n + 1)/f(n) of a term, where it is a fraction of polynomials in n (hypersimp of SymPy, by the factors)
std::optional<Expr> ratioOf(const Expr &f, const Polynomials &p)
{
    const RCP<const Symbol> &n = p.n;
    std::vector<std::pair<Expr, Expr>> factors;
    if (is_a<Mul>(*f)) {
        for (const auto &[base, exponent] : down_cast<const Mul &>(*f).get_dict()) factors.emplace_back(base, exponent);
    } else if (is_a<Pow>(*f)) {
        factors.emplace_back(down_cast<const Pow &>(*f).get_base(), down_cast<const Pow &>(*f).get_exp());
    } else if (!is_a_Number(*f)) {
        factors.emplace_back(f, one);
    }
    Expr ratio = one;
    for (const auto &[base, exponent] : factors) {
        const bool inBase = has_symbol(*base, *n), inExponent = has_symbol(*exponent, *n);
        if (!inBase && !inExponent) continue;
        if (!inBase) {
            //b^(αn + β): b^α
            std::vector<Expr> c;
            try {
                c = p.coefficients(exponent);
            } catch (const MathError &) {
                return std::nullopt;
            }
            if (c.size() != 2) return std::nullopt;
            ratio = mul(ratio, pow(base, c[1]));
            continue;
        }
        if (inExponent || !is_a<Integer>(*exponent)) return std::nullopt;
        if (is_a<Gamma>(*base)) {
            //gamma(αn + β), α an integer: the factors between the two arguments
            const Expr argument = down_cast<const Gamma &>(*base).get_arg();
            std::vector<Expr> c;
            try {
                c = p.coefficients(argument);
            } catch (const MathError &) {
                return std::nullopt;
            }
            if (c.size() != 2 || !is_a<Integer>(*c[1])) return std::nullopt;
            const long alpha = static_cast<long>(down_cast<const Integer &>(*c[1]).as_int());
            Expr step = one;
            if (alpha > 0) {
                for (long j = 0; j < alpha; j++) step = mul(step, add(argument, integer(j)));
            } else {
                for (long j = 1; j <= -alpha; j++) step = div(step, sub(argument, integer(j)));
            }
            ratio = mul(ratio, pow(step, exponent));
            continue;
        }
        //A polynomial in n to an integer power
        try {
            p.coefficients(base);
        } catch (const MathError &) {
            return std::nullopt;
        }
        ratio = mul(ratio, pow(div(p.shift(base, one), base), exponent));
    }
    return ratio;
}

//The non-negative integer roots of a polynomial in h with the parameters: the roots of its linear factors that have no
//parameter
std::vector<long> naturalRoots(const Expr &polynomial, const RCP<const Symbol> &h)
{
    std::set<long> roots;
    if (!has_symbol(*polynomial, *h)) return {};
    for (const auto &[factor, multiplicity] : factorPolynomial(polynomial).factors) {
        std::vector<Expr> c;
        try {
            c = coefficientsOf(factor, h->get_name());
        } catch (const MathError &) {
            continue;
        }
        if (c.size() != 2 || !is_a_Number(*c[0]) || !is_a_Number(*c[1])) continue;
        const Expr root = div(neg(c[0]), c[1]);
        if (is_a<Integer>(*root) && !down_cast<const Integer &>(*root).is_negative() && down_cast<const Integer &>(*root).as_integer_class() < 100000) {
            roots.insert(static_cast<long>(down_cast<const Integer &>(*root).as_int()));
        }
    }
    return std::vector<long>(roots.begin(), roots.end());
}

//Whether an expression has nan or complexInfinity in it
bool undefinedIn(const Expr &expression)
{
    if (is_a<NaN>(*expression) || (is_a<Infty>(*expression) && down_cast<const Infty &>(*expression).is_unsigned_infinity())) return true;
    for (const Expr &argument : expression->get_args()) {
        if (undefinedIn(argument)) return true;
    }
    return false;
}

bool rational(const Expr &expression);

//Whether a factor is a fraction of polynomials: a power of a sum, a variable or a number to an integer
bool rationalFactor(const Expr &base, const Expr &exponent)
{
    if (!is_a<Integer>(*exponent)) return false;
    return is_a<Add>(*base) || is_a<Symbol>(*base) || is_a_Number(*base) || (is_a<Mul>(*base) && rational(base));
}

bool rational(const Expr &expression)
{
    if (is_a_Number(*expression) || is_a<Symbol>(*expression)) return true;
    if (is_a<Add>(*expression)) {
        for (const Expr &term : expression->get_args()) {
            if (!rational(term)) return false;
        }
        return true;
    }
    if (is_a<Mul>(*expression)) {
        for (const auto &[base, exponent] : down_cast<const Mul &>(*expression).get_dict()) {
            if (!rationalFactor(base, exponent) || !rational(base)) return false;
        }
        return true;
    }
    if (is_a<Pow>(*expression)) return rationalFactor(down_cast<const Pow &>(*expression).get_base(), down_cast<const Pow &>(*expression).get_exp()) && rational(down_cast<const Pow &>(*expression).get_base());
    return false;
}

//A fraction of polynomials factored (n/(n + 1)), as it is where that fails
Expr tidyRational(const Expr &value)
{
    try {
        const std::pair<Expr, Expr> fraction = fractionOf(cancelOf(value));
        return factoredFraction(fraction.first, fraction.second);
    } catch (const MathError &error) {
        if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        return value;
    }
}

//A term of the sum: its factor that is a fraction of polynomials factored, times its other factors (powers of a
//variable exponent, gammas), a gamma times its argument written as the next gamma ((n + 1) gamma(n + 1) is gamma(n + 2))
Expr tidyTerm(const Expr &term)
{
    if (!is_a<Mul>(*term)) return term;
    Expr fraction = down_cast<const Mul &>(*term).get_coef();
    std::vector<std::pair<Expr, Expr>> others;
    for (const auto &[base, exponent] : down_cast<const Mul &>(*term).get_dict()) {
        if (rationalFactor(base, exponent) && rational(base)) fraction = mul(fraction, pow(base, exponent));
        else others.emplace_back(base, exponent);
    }
    const Expr tidy = tidyRational(fraction);
    //The factors of the fraction, the gammas raised by those of their arguments
    std::vector<std::pair<Expr, Expr>> factors;
    Expr number = one;
    if (is_a<Mul>(*tidy)) {
        number = down_cast<const Mul &>(*tidy).get_coef();
        for (const auto &[base, exponent] : down_cast<const Mul &>(*tidy).get_dict()) factors.emplace_back(base, exponent);
    } else if (is_a<Pow>(*tidy)) {
        factors.emplace_back(down_cast<const Pow &>(*tidy).get_base(), down_cast<const Pow &>(*tidy).get_exp());
    } else if (is_a_Number(*tidy)) {
        number = tidy;
    } else {
        factors.emplace_back(tidy, one);
    }
    for (auto &[base, exponent] : others) {
        if (!is_a<Gamma>(*base) || !is_a<Integer>(*exponent)) continue;
        const long sign = down_cast<const Integer &>(*exponent).is_positive() ? 1 : -1;
        if (std::abs(down_cast<const Integer &>(*exponent).as_int()) != 1) continue;
        for (bool raised = true; raised;) {
            raised = false;
            const Expr argument = down_cast<const Gamma &>(*base).get_arg();
            for (auto &[factor, power] : factors) {
                if (!is_a<Integer>(*power) || down_cast<const Integer &>(*power).is_zero()) continue;
                const bool same = sign > 0 ? down_cast<const Integer &>(*power).is_positive() : down_cast<const Integer &>(*power).is_negative();
                if (!same || !eq(*expand(sub(factor, argument)), *zero)) continue;
                power = sub(power, integer(sign));
                base = gamma(add(argument, one));
                raised = true;
                break;
            }
        }
    }
    std::vector<std::pair<Expr, Expr>> all;
    for (const auto &[base, exponent] : factors) {
        if (!(is_a<Integer>(*exponent) && down_cast<const Integer &>(*exponent).is_zero())) all.emplace_back(base, exponent);
    }
    for (const auto &[base, exponent] : others) all.emplace_back(base, exponent);
    return productOf(number, all);
}

//The sum collected by its factors that are not fractions of polynomials (2^n, gamma(n + 1); 2^(n + 1) as 2 2^n), the
//fraction of each one factored: -2*2^n + 2n*2^n + 2 is 2(n - 1)*2^n + 2, n gamma(n + 1) + gamma(n + 1) is gamma(n + 2)
Expr collected(const Expr &result)
{
    if (rational(result)) return tidyRational(result);
    const Expr expanded = expand(result);
    std::vector<std::pair<Expr, Expr>> groups;
    const vec_basic terms = is_a<Add>(*expanded) ? expanded->get_args() : vec_basic{expanded};
    for (const Expr &term : terms) {
        Expr fraction = one, other = one;
        std::vector<std::pair<Expr, Expr>> factors;
        if (is_a<Mul>(*term)) {
            fraction = down_cast<const Mul &>(*term).get_coef();
            for (const auto &[base, exponent] : down_cast<const Mul &>(*term).get_dict()) factors.emplace_back(base, exponent);
        } else if (is_a<Pow>(*term)) {
            factors.emplace_back(down_cast<const Pow &>(*term).get_base(), down_cast<const Pow &>(*term).get_exp());
        } else {
            factors.emplace_back(term, one);
        }
        for (const auto &[base, exponent] : factors) {
            if (rationalFactor(base, exponent) && rational(base)) {
                fraction = mul(fraction, pow(base, exponent));
            } else if (is_a<Add>(*exponent) && is_a<Integer>(*down_cast<const Add &>(*exponent).get_coef())) {
                //b^(n + c): b^c b^n
                const Expr constant = down_cast<const Add &>(*exponent).get_coef();
                fraction = mul(fraction, pow(base, constant));
                other = mul(other, pow(base, sub(exponent, constant)));
            } else {
                other = mul(other, pow(base, exponent));
            }
        }
        const auto found = std::find_if(groups.begin(), groups.end(), [&other](const auto &group) { return eq(*group.first, *other); });
        if (found == groups.end()) groups.emplace_back(other, fraction);
        else found->second = add(found->second, fraction);
    }
    std::vector<Expr> collectedTerms;
    for (const auto &[other, fraction] : groups) collectedTerms.push_back(eq(*other, *one) ? tidyRational(fraction) : tidyTerm(mul(tidyRational(fraction), other)));
    return sumOf(collectedTerms);
}

//A name of a variable that is none of the expression's
std::string freshName(const Expr &expression, const std::string &stem)
{
    const std::vector<std::string> used = variablesOf(expression);
    std::string name = stem;
    for (int i = 1; std::find(used.begin(), used.end(), name) != used.end(); i++) name = stem + std::to_string(i);
    return name;
}

//Gosper's term g(n) of f: T(n) = f(n) g(n) with T(n + 1) - T(n) = f(n), or nothing (gosper_term)
std::optional<Expr> gosperTerm(const Expr &f, const Polynomials &p)
{
    const std::optional<Expr> ratio = ratioOf(f, p);
    if (!ratio) return std::nullopt;
    const std::pair<Expr, Expr> fraction = fractionOf(cancelOf(*ratio));
    //The polynomials of the ratio, their normal form Z A(n) C(n + 1)/(B(n) C(n)) (gosper_normal)
    for (const Expr &part : {fraction.first, fraction.second}) {
        try {
            p.coefficients(part);
        } catch (const MathError &) {
            return std::nullopt;
        }
    }
    //A ratio of 0 (k 0^k: its terms 0 past the first): not a hypergeometric term of this form (its leading coefficients
    //were read from an empty list, a crash)
    if (eq(*fraction.first, *zero) || eq(*fraction.second, *zero)) return std::nullopt;
    const Expr Z = cancelOf(div(p.lead(fraction.first), p.lead(fraction.second)));
    Expr A = p.monic(fraction.first), B = p.monic(fraction.second), C = one;
    if (p.degree(A) > 0 && p.degree(B) > 0) {
        const RCP<const Symbol> h = symbol(freshName(add(A, B), "h"));
        const Expr resultant = polyOperation("resultant", {A, p.shift(B, h)}, {p.n->get_name()}).expression;
        for (const long i : naturalRoots(resultant, h)) {
            checkpoint();
            const Expr d = p.gcd(A, p.shift(B, integer(i)));
            A = p.quotient(A, d);
            B = p.quotient(B, p.shift(d, integer(-i)));
            for (long j = 1; j <= i; j++) C = expand(mul(C, p.shift(d, integer(-j))));
        }
    }
    A = expand(mul(Z, A));
    B = p.shift(B, minus_one);
    //The degree of the polynomial x with A x(n + 1) - B x(n) = C
    const long N = p.degree(A), M = p.degree(B), K = p.degree(C);
    std::vector<Expr> degrees;
    if (N != M || !eq(*cancelOf(sub(p.lead(A), p.lead(B))), *zero)) {
        degrees.push_back(integer(K - std::max(N, M)));
    } else if (N == 0) {
        degrees.push_back(integer(K - N + 1));
        degrees.push_back(zero);
    } else {
        degrees.push_back(integer(K - N + 1));
        degrees.push_back(cancelOf(div(sub(p.nth(B, N - 1), p.nth(A, N - 1)), p.lead(A))));
    }
    long d = -1;
    for (const Expr &value : degrees) {
        if (is_a<Integer>(*value) && !down_cast<const Integer &>(*value).is_negative() && down_cast<const Integer &>(*value).as_integer_class() <= 200) {
            d = std::max(d, static_cast<long>(down_cast<const Integer &>(*value).as_int()));
        }
    }
    if (d < 0) return std::nullopt;
    //Its coefficients: a linear system
    std::vector<std::string> names;
    Expr x = zero;
    for (long i = 0; i <= d; i++) {
        names.push_back(freshName(add(add(A, B), add(C, x)), "c" + std::to_string(i)));
        x = add(x, mul(symbol(names.back()), pow(p.n, integer(i))));
    }
    const Expr H = expand(sub(sub(mul(A, p.shift(x, one)), mul(B, x)), C));
    const LinearSolution solution = solveLinearOf(p.coefficients(H), names);
    if (solution.kind == "empty") return std::nullopt;
    //The values of the coefficients, in terms of the others, which are 0
    map_basic_basic values, free;
    for (const std::string &name : names) {
        free[symbol(name)] = zero;
        values[symbol(name)] = zero;
    }
    for (const auto &[name, value] : solution.values) values[symbol(name)] = subs(value, free);
    x = cancelOf(subs(x, values));
    if (eq(*x, *zero)) return std::nullopt;
    return div(mul(B, x), C);
}

}

std::optional<Expr> gosperSum(const Expr &term, const RCP<const Symbol> &k, const Expr &low, const Expr &high)
{
    if (is_a<Infty>(*low) || is_a<Infty>(*high)) return std::nullopt;
    //The index as a variable of the operations of the polynomials
    Polynomials p{symbol(freshName(add(term, add(low, high)), "n"))};
    map_basic_basic renamed;
    renamed[k] = p.n;
    const Expr f = xreplace(term, renamed);
    std::optional<Expr> g;
    try {
        g = gosperTerm(f, p);
    } catch (const MathError &error) {
        if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
        return std::nullopt;
    }
    if (!g) return std::nullopt;
    //f(b)(g(b) + 1) - f(a)g(a), the products cancelled first (f is 0 where g has a pole: k 2^k and (k - 2)/k at 0);
    //nothing where one of them has no value (SymPy takes limits there)
    const auto cancelled = [](const Expr &value) {
        try {
            return cancelOf(value);
        } catch (const MathError &error) {
            if (error.code() == ErrorCode::Cancelled || error.code() == ErrorCode::Timeout) throw;
            return value;
        }
    };
    map_basic_basic atHigh, atLow;
    atHigh[p.n] = high;
    atLow[p.n] = low;
    const Expr upper = subs(cancelled(mul(f, add(*g, one))), atHigh), lower = subs(cancelled(mul(f, *g)), atLow);
    const Expr result = sub(upper, lower);
    if (undefinedIn(result)) return std::nullopt;
    return collected(result);
}

}
