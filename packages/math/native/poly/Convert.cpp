//Expressions as polynomials over the integers and back (see Convert.h), the generators found as SymPy's
//decompose_power and _parallel_dict_from_expr find them
#include "Convert.h"

#include <algorithm>
#include <unordered_map>

#include <symengine/add.h>
#include <symengine/complex.h>
#include <symengine/mul.h>
#include <symengine/pow.h>
#include <symengine/rational.h>
#include <symengine/symbol.h>

#include "../core/Errors.h"
#include "../printer/Printer.h"

namespace math {
namespace poly {

using namespace SymEngine;

namespace {

//The dense form of a polynomial is the product of its degrees plus one: bounded
const double MAX_DENSE = 1e6;

//A term of an expanded expression: its rational coefficient, and its factors as powers of generators
struct ExprTerm {
    rational_class coefficient;
    std::vector<std::pair<Expr, long>> powers;
};

[[noreturn]] void notPolynomial(const Expr &expression, const std::string &why)
{
    throw MathError(ErrorCode::NotSupported, toText(expression) + " is not a polynomial: " + why);
}

//A power of a generator, bounded before it is a long (32 bits on Windows): the dense form bounds it anyway
long powerOf(const integer_class &n, const Expr &expression)
{
    if (n > 1000000) throw MathError(ErrorCode::NotSupported, "A polynomial of a degree too high for its dense form: " + toText(expression));
    return static_cast<long>(mp_get_si(n));
}

//A factor b^e as a generator and its power (decompose_power)
std::pair<Expr, long> decompose(const Expr &factor, const Expr &expression)
{
    if (!is_a<Pow>(*factor)) return {factor, 1};
    const Pow &power = down_cast<const Pow &>(*factor);
    const Expr base = power.get_base(), exponent = power.get_exp();
    if (is_a<Integer>(*exponent)) {
        const integer_class &n = down_cast<const Integer &>(*exponent).as_integer_class();
        if (n < 0) notPolynomial(expression, "a negative power");
        return {base, powerOf(n, expression)};
    }
    if (is_a<Rational>(*exponent)) {
        const rational_class &r = down_cast<const Rational &>(*exponent).as_rational_class();
        if (r < 0) notPolynomial(expression, "a negative power");
        return {pow(base, Rational::from_two_ints(*integer(1), *integer(get_den(r)))), powerOf(get_num(r), expression)};
    }
    //A symbolic exponent: its rational coefficient c = p/q, b^(c t) is (b^(t/q))^p
    if (is_a<Mul>(*exponent)) {
        const Mul &product = down_cast<const Mul &>(*exponent);
        const RCP<const Number> &c = product.get_coef();
        if (is_a<Rational>(*c) || (is_a<Integer>(*c) && !c->is_one())) {
            rational_class r = is_a<Rational>(*c) ? down_cast<const Rational &>(*c).as_rational_class() : rational_class(down_cast<const Integer &>(*c).as_integer_class());
            if (r < 0) notPolynomial(expression, "a negative power");
            const Expr tail = div(exponent, c);
            const Expr generator = pow(base, mul(Rational::from_two_ints(*integer(1), *integer(get_den(r))), tail));
            return {generator, powerOf(get_num(r), expression)};
        }
    }
    return {factor, 1};
}

//The rational coefficient of a number of an expression
rational_class coefficientOf(const Number &number, const Expr &expression)
{
    if (is_a<Integer>(number)) return rational_class(down_cast<const Integer &>(number).as_integer_class());
    if (is_a<Rational>(number)) return down_cast<const Rational &>(number).as_rational_class();
    if (is_a<Complex>(number)) notPolynomial(expression, "its coefficients are complex numbers");
    notPolynomial(expression, "its coefficients are not exact");
}

//The terms of an expanded expression
std::vector<ExprTerm> termsOf(const Expr &expression)
{
    const Expr expanded = expand(expression);
    std::vector<Expr> terms;
    rational_class constant(0);
    if (is_a<Add>(*expanded)) {
        const Add &sum = down_cast<const Add &>(*expanded);
        constant = coefficientOf(*sum.get_coef(), expression);
        for (const auto &[term, coefficient] : sum.get_dict()) terms.push_back(mul(term, coefficient));
    } else {
        terms.push_back(expanded);
    }
    std::vector<ExprTerm> result;
    if (constant != 0) result.push_back({constant, {}});
    for (const Expr &term : terms) {
        ExprTerm entry{rational_class(1), {}};
        if (is_a_Number(*term)) {
            entry.coefficient = coefficientOf(down_cast<const Number &>(*term), expression);
            if (entry.coefficient == 0) continue;
        } else if (is_a<Mul>(*term)) {
            const Mul &product = down_cast<const Mul &>(*term);
            entry.coefficient = coefficientOf(*product.get_coef(), expression);
            for (const auto &[base, exponent] : product.get_dict()) entry.powers.push_back(decompose(pow(base, exponent), expression));
        } else {
            entry.powers.push_back(decompose(term, expression));
        }
        result.push_back(std::move(entry));
    }
    return result;
}

//The order of the generators: the symbols by their names, then the others by their text
bool generatorBefore(const Expr &a, const Expr &b)
{
    const bool symbolA = is_a<Symbol>(*a), symbolB = is_a<Symbol>(*b);
    if (symbolA != symbolB) return symbolA;
    if (symbolA) return down_cast<const Symbol &>(*a).get_name() < down_cast<const Symbol &>(*b).get_name();
    const std::string textA = toText(a), textB = toText(b);
    if (textA != textB) return textA < textB;
    return a->__cmp__(*b) < 0;
}

}

Polynomials toPolynomials(const std::vector<Expr> &expressions, const std::string &first)
{
    std::vector<std::vector<ExprTerm>> all;
    std::unordered_map<Expr, std::size_t, RCPBasicHash, RCPBasicKeyEq> index;
    Polynomials result;
    const auto add = [&index, &result](const Expr &generator) {
        if (index.find(generator) == index.end()) {
            index[generator] = result.generators.size();
            result.generators.push_back(generator);
        }
    };
    if (!first.empty()) add(symbol(first));
    for (const Expr &expression : expressions) {
        all.push_back(termsOf(expression));
        for (const ExprTerm &term : all.back()) for (const auto &power : term.powers) add(power.first);
    }
    //The generators in their order (the one named first, first)
    std::vector<Expr> ordered = result.generators;
    std::sort(ordered.begin() + (first.empty() ? 0 : 1), ordered.end(), generatorBefore);
    std::vector<std::size_t> position(ordered.size());
    for (std::size_t i = 0; i < ordered.size(); i++) position[index[ordered[i]]] = i;
    result.generators = ordered;
    const std::size_t n = std::max<std::size_t>(ordered.size(), 1);
    result.u = static_cast<long>(n) - 1;
    for (std::size_t k = 0; k < expressions.size(); k++) {
        //The terms of integer coefficients: the rational ones times the lcm of their denominators
        Z denominator(1);
        for (const ExprTerm &term : all[k]) denominator = lcm(denominator, get_den(term.coefficient));
        std::vector<Term> terms;
        std::vector<long> degrees(n, 0);
        for (const ExprTerm &term : all[k]) {
            std::vector<long> exponents(n, 0);
            for (const auto &[generator, power] : term.powers) exponents[position[index[generator]]] += power;
            for (std::size_t i = 0; i < n; i++) degrees[i] = std::max(degrees[i], exponents[i]);
            terms.push_back({exponents, get_num(term.coefficient) * (denominator / get_den(term.coefficient))});
        }
        double dense = 1;
        for (const long degree : degrees) dense *= static_cast<double>(degree + 1);
        if (dense > MAX_DENSE) {
            std::string list;
            for (std::size_t i = 0; i < ordered.size(); i++) list += (i ? ", " : "") + toText(ordered[i]) + "^" + std::to_string(degrees[i]);
            throw MathError(ErrorCode::NotSupported, "A polynomial of degrees too high together (" + list + ") for its dense form");
        }
        result.polys.push_back(dmp_from_terms(terms, result.u));
        result.denominators.push_back(denominator);
        if (denominator != 1) result.rational = true;
    }
    return result;
}

Expr fromPolynomial(const Dmp &f, long u, const std::vector<Expr> &generators, const Z &denominator)
{
    Expr sum = zero;
    for (const Term &term : dmp_to_terms(f, u)) {
        Expr product = Rational::from_mpq(rational_class(term.coefficient, denominator));
        for (std::size_t i = 0; i < generators.size(); i++) {
            if (term.exponents[i]) product = mul(product, pow(generators[i], integer(term.exponents[i])));
        }
        sum = add(sum, product);
    }
    return sum;
}

Expr monicPolynomial(const Dmp &f, long u, const std::vector<Expr> &generators)
{
    if (dmp_zero_p(f, u)) return zero;
    const Z lc = dmp_ground_LC(f, u);
    Expr sum = zero;
    for (const Term &term : dmp_to_terms(f, u)) {
        Expr product = Rational::from_mpq(rational_class(term.coefficient, lc));
        for (std::size_t i = 0; i < generators.size(); i++) {
            if (term.exponents[i]) product = mul(product, pow(generators[i], integer(term.exponents[i])));
        }
        sum = add(sum, product);
    }
    return sum;
}

}
}
