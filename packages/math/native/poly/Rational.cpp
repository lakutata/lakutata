//Fractions of polynomials (see Rational.h)
#include "Rational.h"

#include <utility>
#include <vector>

#include <symengine/add.h>
#include <symengine/integer.h>
#include <symengine/mul.h>
#include <symengine/pow.h>
#include <symengine/rational.h>
#include <symengine/symbol.h>
#include <symengine/visitor.h>

#include "../async/Pool.h"
#include "../core/Errors.h"
#include "../ops/Operations.h"
#include "../parser/Parser.h"
#include "../printer/Printer.h"
#include "Convert.h"
#include "Euclid.h"
#include "Factor.h"
#include "Poly.h"

namespace math {

using namespace SymEngine;
using namespace poly;

namespace {

//A fraction cancelled, and whether a polynomial that is not a number was cancelled
struct Cancelled {
    Expr result;
    bool reduced = false;
};

//SymPy's cancel(): the numerator and the denominator (as_numer_denom) as polynomials over the integers in their
//common generators, divided by their gcd (dmp_cancel), the signs of their leading coefficients taken out in front
Cancelled cancelWith(const Expr &expression)
{
    const std::pair<Expr, Expr> fraction = fractionOf(expression);
    const Polynomials p = toPolynomials({fraction.first, fraction.second});
    if (p.generators.empty()) return {expression, false};
    const long u = p.u;
    //(F/a)/(G/b) is (F b)/(G a)
    const Dmp F = dmp_mul_ground(p.polys[0], p.denominators[1], u), G = dmp_mul_ground(p.polys[1], p.denominators[0], u);
    const Cofactors common = dmp_inner_gcd(F, G, u);
    Dmp top = common.cff, bottom = common.cfg;
    const bool topNegative = !dmp_zero_p(top, u) && dmp_ground_LC(top, u) < 0, bottomNegative = dmp_ground_LC(bottom, u) < 0;
    if (topNegative) top = dmp_neg(top, u);
    if (bottomNegative) bottom = dmp_neg(bottom, u);
    const Expr sign = topNegative != bottomNegative ? minus_one : one;
    const Expr numerator = fromPolynomial(top, u, p.generators), denominator = fromPolynomial(bottom, u, p.generators);
    Cancelled result;
    result.reduced = !dmp_ground_p(common.h, u);
    //Over a number: the number multiplied in, as in SymPy ((x + 1)/2 is x/2 + 1/2)
    if (is_a_Number(*denominator)) {
        result.result = mul(div(sign, denominator), numerator);
    } else {
        result.result = productOf(sign, {{numerator, one}, {denominator, minus_one}});
    }
    return result;
}

//A denominator as its number and its bases with their exponents; a base to an exponent that is not a number is a base
//(x^y)
void denominatorOf(const Expr &denominator, RCP<const Number> &number, map_basic_basic &powers)
{
    number = one;
    powers.clear();
    const auto put = [&powers](const Expr &base, const Expr &exponent) {
        if (is_a_Number(*exponent)) {
            powers[base] = exponent;
        } else {
            powers[pow(base, exponent)] = one;
        }
    };
    if (is_a_Number(*denominator)) {
        number = rcp_static_cast<const Number>(denominator);
    } else if (is_a<Mul>(*denominator)) {
        number = down_cast<const Mul &>(*denominator).get_coef();
        for (const auto &[base, exponent] : down_cast<const Mul &>(*denominator).get_dict()) put(base, exponent);
    } else if (is_a<Pow>(*denominator)) {
        put(down_cast<const Pow &>(*denominator).get_base(), down_cast<const Pow &>(*denominator).get_exp());
    } else {
        powers[denominator] = one;
    }
}

//The terms of a sum over one denominator (SymPy's _together of a sum); a sum with an infinity or NaN as it is
Expr togetherSum(const Expr &sum)
{
    const Add &terms = down_cast<const Add &>(*sum);
    if (!terms.get_coef()->is_exact()) return sum;
    for (const auto &entry : terms.get_dict()) {
        if (!entry.second->is_exact()) return sum;
    }
    std::vector<Expr> numerators;
    std::vector<RCP<const Number>> numbers;
    std::vector<map_basic_basic> denominators;
    bool fractions = false;
    for (const Expr &term : sum->get_args()) {
        checkpoint();
        const std::pair<Expr, Expr> fraction = fractionOf(togetherOf(term));
        RCP<const Number> number;
        map_basic_basic powers;
        denominatorOf(fraction.second, number, powers);
        Expr numerator = fraction.first;
        //A number of the denominator that is not an integer goes to the numerator
        if (!is_a<Integer>(*number)) {
            numerator = div(numerator, number);
            number = one;
        }
        fractions = fractions || !powers.empty() || !number->is_one();
        numerators.push_back(numerator);
        numbers.push_back(number);
        denominators.push_back(std::move(powers));
    }
    if (!fractions) return sum;
    //The lcm of the numbers, each base to its greatest exponent
    integer_class lcm(1);
    map_basic_basic greatest;
    for (size_t i = 0; i < numerators.size(); i++) {
        mp_lcm(lcm, lcm, mp_abs(down_cast<const Integer &>(*numbers[i]).as_integer_class()));
        for (const auto &[base, exponent] : denominators[i]) {
            const auto found = greatest.find(base);
            if (found == greatest.end()) {
                greatest.emplace(base, exponent);
            } else if (down_cast<const Number &>(*sub(exponent, found->second)).is_positive()) {
                found->second = exponent;
            }
        }
    }
    const RCP<const Integer> common = integer(lcm);
    Expr numerator = zero;
    for (size_t i = 0; i < numerators.size(); i++) {
        checkpoint();
        Expr term = mul(numerators[i], div(common, numbers[i]));
        for (const auto &[base, exponent] : greatest) {
            const auto found = denominators[i].find(base);
            term = mul(term, pow(base, found == denominators[i].end() ? exponent : sub(exponent, found->second)));
        }
        numerator = add(numerator, term);
    }
    numerator = expand(numerator);
    std::vector<std::pair<Expr, Expr>> factors{{numerator, one}};
    for (const auto &[base, exponent] : greatest) factors.emplace_back(base, neg(exponent));
    return productOf(div(one, common), factors);
}

//The coefficient of x^r (the first variable) in a polynomial of the level u: a polynomial of the level u - 1, at the
//level 0 a number as a polynomial of the level 0
Dmp coefficientIn(const Dmp &f, long r, long u)
{
    const long n = dmp_degree(f, u);
    if (r < 0 || r > n) return Dmp();
    if (u == 0) return dmp_ground(f.g[static_cast<size_t>(n - r)], 0);
    return f.c[static_cast<size_t>(n - r)];
}

//A polynomial of the level u - 1 (at the level 0 a number) as one of the level u without the first variable
Dmp lifted(const Dmp &c, long u)
{
    if (u == 0 || dmp_zero_p(c, u - 1)) return c;
    Dmp f;
    f.c.push_back(c);
    return f;
}

//The polynomial of the coefficients of x^0, x^1… (each of the level u - 1; at the level 0 a number)
Dmp fromCoefficients(const std::vector<Dmp> &coefficients, long u)
{
    Dmp f;
    for (size_t t = coefficients.size(); t-- > 0;) {
        if (u == 0) {
            f.g.push_back(coefficients[t].g.empty() ? Z(0) : coefficients[t].g[0]);
        } else {
            f.c.push_back(coefficients[t]);
        }
    }
    dmp_strip(f, u);
    return f;
}

//x^t f
Dmp shifted(const Dmp &f, long t, long u)
{
    if (dmp_zero_p(f, u)) return f;
    Dmp g = f;
    for (long i = 0; i < t; i++) {
        if (u == 0) {
            g.g.push_back(Z(0));
        } else {
            g.c.push_back(Dmp());
        }
    }
    return g;
}

//A square linear system A y = b (b the last column) of polynomials of the level v over the integers, by Bareiss'
//fraction-free elimination: y times the last pivot (the determinant, its sign as the row swaps left it) is a vector of
//polynomials (Cramer's rule), each division exact
std::vector<Dmp> solveFractionFree(std::vector<std::vector<Dmp>> A, long v, Dmp &determinant)
{
    const size_t n = A.size();
    Dmp previous = dmp_one(v);
    for (size_t k = 0; k < n; k++) {
        checkpoint();
        size_t pivot = k;
        while (pivot < n && dmp_zero_p(A[pivot][k], v)) pivot++;
        if (pivot == n) throw MathError(ErrorCode::Internal, "The system of the partial fractions is singular");
        std::swap(A[k], A[pivot]);
        for (size_t i = k + 1; i < n; i++) {
            for (size_t j = k + 1; j <= n; j++) A[i][j] = dmp_exquo(dmp_sub(dmp_mul(A[k][k], A[i][j], v), dmp_mul(A[i][k], A[k][j], v), v), previous, v);
            A[i][k] = Dmp();
        }
        previous = A[k][k];
    }
    determinant = A[n - 1][n - 1];
    std::vector<Dmp> y(n);
    for (size_t i = n; i-- > 0;) {
        checkpoint();
        Dmp sum = dmp_mul(A[i][n], determinant, v);
        for (size_t j = i + 1; j < n; j++) sum = dmp_sub(sum, dmp_mul(A[i][j], y[j], v), v);
        y[i] = dmp_exquo(sum, A[i][i], v);
    }
    return y;
}

//The polynomial part of the partial fractions: the terms of the coefficients over the denominator (each of the level
//u - 1), cancelled, times the powers of the variable
std::vector<Expr> polynomialPart(const std::vector<Dmp> &numerators, const Dmp &denominator, const Polynomials &p)
{
    const long u = p.u, v = u == 0 ? 0 : u - 1;
    std::vector<Expr> terms;
    for (size_t t = 0; t < numerators.size(); t++) {
        if (dmp_zero_p(numerators[t], v)) continue;
        const Cofactors common = dmp_inner_gcd(numerators[t], denominator, v);
        Dmp top = common.cff, bottom = common.cfg;
        if (dmp_ground_LC(bottom, v) < 0) {
            top = dmp_neg(top, v);
            bottom = dmp_neg(bottom, v);
        }
        //The integer contents in front (x^2/(2(y + 1)))
        Z topContent, bottomContent;
        top = dmp_ground_primitive(top, v, topContent);
        bottom = dmp_ground_primitive(bottom, v, bottomContent);
        const Expr power = pow(p.generators[0], integer(static_cast<long>(t)));
        const Expr coefficient = Rational::from_mpq(rational_class(topContent, bottomContent));
        terms.push_back(productOf(coefficient, {{fromPolynomial(lifted(top, u), u, p.generators), one}, {fromPolynomial(lifted(bottom, u), u, p.generators), minus_one}, {power, one}}));
    }
    return terms;
}

Expr simplest(const Expr &expression)
{
    try {
        return cancelOf(expression);
    } catch (const MathError &error) {
        if (error.code() != ErrorCode::NotSupported) throw;
        return expression;
    }
}

}

Expr cancelOf(const Expr &expression)
{
    return cancelWith(expression).result;
}

bool cancelled(const Expr &expression, Expr &result)
{
    const Cancelled found = cancelWith(expression);
    if (!found.reduced) return false;
    result = found.result;
    return true;
}

Expr togetherOf(const Expr &expression)
{
    if (is_a<Add>(*expression)) return togetherSum(expression);
    if (is_a<Mul>(*expression)) {
        const Mul &product = down_cast<const Mul &>(*expression);
        std::vector<std::pair<Expr, Expr>> factors;
        for (const auto &[base, exponent] : product.get_dict()) {
            const Expr inner = togetherOf(base);
            if (is_a<Integer>(*exponent)) {
                factors.emplace_back(inner, exponent);
            } else {
                factors.emplace_back(pow(inner, exponent), one);
            }
        }
        return productOf(product.get_coef(), factors);
    }
    if (is_a<Pow>(*expression)) {
        const Pow &power = down_cast<const Pow &>(*expression);
        const Expr inner = togetherOf(power.get_base());
        if (is_a<Integer>(*power.get_exp())) return productOf(one, {{inner, power.get_exp()}});
        return pow(inner, power.get_exp());
    }
    return expression;
}

Expr apartOf(const Expr &expression, const std::string &name)
{
    if (!isName(name) || isBuiltin(name)) throw MathError(ErrorCode::Argument, name + " is not a variable");
    const RCP<const Symbol> x = symbol(name);
    const std::pair<Expr, Expr> fraction = fractionOf(expression);
    const Polynomials p = toPolynomials({fraction.first, fraction.second}, name);
    for (size_t i = 1; i < p.generators.size(); i++) {
        if (has_symbol(*p.generators[i], *x)) throw MathError(ErrorCode::NotSupported, toText(expression) + " is not a fraction of polynomials in " + name);
    }
    const long u = p.u, v = u == 0 ? 0 : u - 1;
    Dmp P = dmp_mul_ground(p.polys[0], p.denominators[1], u), Q = dmp_mul_ground(p.polys[1], p.denominators[0], u);
    const Cofactors common = dmp_inner_gcd(P, Q, u);
    P = common.cff;
    Q = common.cfg;
    if (dmp_zero_p(P, u)) return zero;
    const long m = dmp_degree(P, u);
    //A denominator without the variable: the polynomial part alone
    if (dmp_degree(Q, u) == 0) {
        std::vector<Dmp> numerators;
        for (long t = 0; t <= m; t++) numerators.push_back(coefficientIn(P, t, u));
        return sumOf(polynomialPart(numerators, coefficientIn(Q, 0, u), p));
    }
    //The factors of the denominator with the variable, and the others (C, of the parameters)
    const Factorization factored = dmp_factor_list(Q, u);
    Dmp C = dmp_ground(factored.coefficient, u);
    std::vector<std::pair<Dmp, long>> factors;
    for (const auto &[factor, k] : factored.factors) {
        if (dmp_degree(factor, u) == 0) {
            C = dmp_mul(C, dmp_pow(factor, static_cast<unsigned long>(k), u), u);
        } else {
            factors.emplace_back(factor, k);
        }
    }
    const Dmp rest = dmp_exquo(Q, C, u);
    const long n = dmp_degree(rest, u);
    //The unknowns: the coefficients of the polynomial part S, and of the numerators h_j of the fractions h_j/q^j; P is
    //C (S rest + the sum of h_j rest/q^j), its coefficients the equations
    std::vector<Dmp> basis;
    std::vector<std::pair<long, long>> unknowns;
    std::vector<std::pair<Dmp, long>> fractions;
    if (m >= n) {
        for (long t = 0; t <= m - n; t++) {
            basis.push_back(shifted(rest, t, u));
            unknowns.emplace_back(-1, t);
        }
    }
    for (const auto &[q, k] : factors) {
        Dmp cofactor = rest;
        for (long j = 1; j <= k; j++) {
            cofactor = dmp_exquo(cofactor, q, u);
            const long group = static_cast<long>(fractions.size());
            fractions.emplace_back(q, j);
            for (long t = 0; t < dmp_degree(q, u); t++) {
                basis.push_back(shifted(cofactor, t, u));
                unknowns.emplace_back(group, t);
            }
        }
    }
    const size_t size = basis.size();
    std::vector<std::vector<Dmp>> A(size, std::vector<Dmp>(size + 1));
    for (size_t r = 0; r < size; r++) {
        for (size_t c = 0; c < size; c++) A[r][c] = coefficientIn(basis[c], static_cast<long>(r), u);
        A[r][size] = coefficientIn(P, static_cast<long>(r), u);
    }
    Dmp determinant;
    const std::vector<Dmp> y = solveFractionFree(std::move(A), v, determinant);
    //Each unknown is y/(det C)
    const Dmp denominator = dmp_mul(determinant, coefficientIn(C, 0, u), v);
    std::vector<Dmp> polynomial(m >= n ? static_cast<size_t>(m - n + 1) : 0);
    std::vector<std::vector<Dmp>> numerators(fractions.size());
    for (size_t i = 0; i < size; i++) {
        const auto &[group, t] = unknowns[i];
        std::vector<Dmp> &coefficients = group < 0 ? polynomial : numerators[static_cast<size_t>(group)];
        if (coefficients.size() <= static_cast<size_t>(t)) coefficients.resize(static_cast<size_t>(t) + 1);
        coefficients[static_cast<size_t>(t)] = y[i];
    }
    std::vector<Expr> terms = polynomialPart(polynomial, denominator, p);
    for (size_t i = 0; i < fractions.size(); i++) {
        checkpoint();
        const Dmp top = fromCoefficients(numerators[i], u);
        if (dmp_zero_p(top, u)) continue;
        const Dmp bottom = dmp_mul(lifted(denominator, u), dmp_pow(fractions[i].first, static_cast<unsigned long>(fractions[i].second), u), u);
        terms.push_back(factoredFraction(fromPolynomial(top, u, p.generators), fromPolynomial(bottom, u, p.generators)));
    }
    return sumOf(terms);
}

Expr completeSquareOf(const Expr &expression, const std::string &name)
{
    const std::vector<Expr> coefficients = coefficientsOf(expression, name);
    if (coefficients.size() != 3) throw MathError(ErrorCode::NotSupported, toText(expression) + " is not a polynomial of degree 2 in " + name);
    const Expr &a = coefficients[2], &b = coefficients[1], &c = coefficients[0];
    const Expr shift = simplest(div(b, mul(integer(2), a)));
    const Expr rest = simplest(sub(c, div(pow(b, integer(2)), mul(integer(4), a))));
    return sumOf({mul(a, pow(add(symbol(name), shift), integer(2))), rest});
}

}
