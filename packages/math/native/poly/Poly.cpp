//The operations of math.poly on expressions (see Poly.h)
#include "Poly.h"

#include <algorithm>
#include <tuple>

#include <symengine/add.h>
#include <symengine/integer.h>
#include <symengine/mul.h>
#include <symengine/pow.h>
#include <symengine/rational.h>

#include "../core/Errors.h"
#include "../ops/Operations.h"
#include "../parser/Parser.h"
#include "../printer/Printer.h"
#include "Convert.h"
#include "Euclid.h"
#include "Factor.h"
#include "Rational.h"

namespace math {

using namespace SymEngine;
using namespace poly;

namespace {

void checkVariable(const std::string &name)
{
    if (!isName(name) || isBuiltin(name)) throw MathError(ErrorCode::Argument, name + " is not a variable");
}

//The rational of a constant polynomial (of no generator), divided by a denominator
rational_class constantOf(const Dmp &f, const Z &denominator)
{
    return rational_class(dmp_ground_LC(f, 0), denominator);
}

Expr numberOf(const rational_class &value)
{
    return Rational::from_mpq(rational_class(value));
}

//The gcd or the lcm of numbers: of their numerators, and the lcm or the gcd of their denominators
Expr numbersGcdLcm(const Polynomials &p, bool isGcd)
{
    Z numerator(0), denominator(isGcd ? 0 : 1);
    bool first = true;
    for (std::size_t i = 0; i < p.polys.size(); i++) {
        const rational_class value = constantOf(p.polys[i], p.denominators[i]);
        const Z top = mp_abs(get_num(value)), bottom = get_den(value);
        if (first) {
            numerator = top;
            denominator = bottom;
            first = false;
        } else if (isGcd) {
            numerator = gcd(numerator, top);
            denominator = lcm(denominator, bottom);
        } else {
            numerator = lcm(numerator, top);
            denominator = gcd(denominator, bottom);
        }
    }
    if (numerator == 0) return zero;
    return numberOf(rational_class(numerator, denominator));
}

Expr gcdLcmOf(const std::vector<Expr> &expressions, bool isGcd)
{
    if (expressions.empty()) throw MathError(ErrorCode::Argument, std::string("The ") + (isGcd ? "gcd" : "lcm") + " of no polynomial");
    const Polynomials p = toPolynomials(expressions);
    if (p.generators.empty()) return numbersGcdLcm(p, isGcd);
    Dmp result = p.polys[0];
    if (p.polys.size() == 1) {
        //One polynomial: itself, its leading coefficient positive
        if (dmp_ground_LC(result, p.u) < 0) result = dmp_neg(result, p.u);
    }
    for (std::size_t i = 1; i < p.polys.size(); i++) {
        result = isGcd ? dmp_gcd(result, p.polys[i], p.u) : dmp_lcm(result, p.polys[i], p.u);
    }
    //Over the rationals: monic
    if (p.rational) return monicPolynomial(result, p.u, p.generators);
    return fromPolynomial(result, p.u, p.generators);
}

//The generators but the first
std::vector<Expr> others(const Polynomials &p)
{
    return std::vector<Expr>(p.generators.begin() + 1, p.generators.end());
}

Expr resultantOf(const Expr &a, const Expr &b, const std::string &name)
{
    checkVariable(name);
    const Polynomials p = toPolynomials({a, b}, name);
    const Dmp &F = p.polys[0], &G = p.polys[1];
    const Dmp r = dmp_resultant(F, G, p.u);
    //res(F/a, G/b) = res(F, G)/(a^deg G b^deg F)
    Z scale(1);
    if (p.rational) {
        Z left, right;
        mp_pow_ui(left, p.denominators[0], static_cast<unsigned long>(std::max(dmp_degree(G, p.u), 0L)));
        mp_pow_ui(right, p.denominators[1], static_cast<unsigned long>(std::max(dmp_degree(F, p.u), 0L)));
        scale = left * right;
    }
    if (p.u == 0) return numberOf(rational_class(dmp_ground_LC(r, 0), scale));
    return fromPolynomial(r, p.u - 1, others(p), scale);
}

Expr discriminantOf(const Expr &f, const std::string &name)
{
    checkVariable(name);
    const Polynomials p = toPolynomials({f}, name);
    const Dmp &F = p.polys[0];
    const Dmp d = dmp_discriminant(F, p.u);
    //disc(F/a) = disc(F)/a^(2n - 2)
    const long n = dmp_degree(F, p.u);
    Z scale(1);
    if (p.rational && n >= 1) mp_pow_ui(scale, p.denominators[0], static_cast<unsigned long>(2 * n - 2));
    if (p.u == 0) return numberOf(rational_class(dmp_ground_LC(d, 0), scale));
    return fromPolynomial(d, p.u - 1, others(p), scale);
}

//A factorization as expressions: the coefficient, the factors and their multiplicities, ordered by their total degrees
//then their texts
struct ExprFactors {
    Expr coefficient;
    std::vector<std::pair<Expr, long>> factors;
};

long totalDegree(const Dmp &f, long u)
{
    long degree = 0;
    for (const Term &term : dmp_to_terms(f, u)) {
        long sum = 0;
        for (const long e : term.exponents) sum += e;
        degree = std::max(degree, sum);
    }
    return degree;
}

ExprFactors factorsOf(const Expr &expression, bool squareFree)
{
    const Polynomials p = toPolynomials({expression});
    const Factorization factored = squareFree ? dmp_sqf_list(p.polys[0], p.u) : dmp_factor_list(p.polys[0], p.u);
    ExprFactors result;
    result.coefficient = numberOf(rational_class(factored.coefficient, p.denominators[0]));
    std::vector<std::tuple<long, std::string, long, Expr>> ordered;
    for (const auto &[factor, k] : factored.factors) {
        const Expr e = fromPolynomial(factor, p.u, p.generators);
        ordered.emplace_back(totalDegree(factor, p.u), toText(e), k, e);
    }
    std::sort(ordered.begin(), ordered.end(), [](const auto &a, const auto &b) {
        if (std::get<0>(a) != std::get<0>(b)) return std::get<0>(a) < std::get<0>(b);
        if (std::get<1>(a) != std::get<1>(b)) return std::get<1>(a) < std::get<1>(b);
        return std::get<2>(a) < std::get<2>(b);
    });
    for (const auto &entry : ordered) result.factors.push_back({std::get<3>(entry), std::get<2>(entry)});
    return result;
}

//The factored form of a fraction: the factors of its numerator and of its denominator (a negative multiplicity)
Expr factoredOf(const Expr &numerator, const Expr &denominator, bool squareFree)
{
    const ExprFactors top = factorsOf(numerator, squareFree);
    std::vector<std::pair<Expr, Expr>> factors;
    for (const auto &[factor, k] : top.factors) factors.emplace_back(factor, integer(k));
    if (eq(*denominator, *one)) return productOf(top.coefficient, factors);
    const ExprFactors bottom = factorsOf(denominator, squareFree);
    for (const auto &[factor, k] : bottom.factors) factors.emplace_back(factor, integer(-k));
    return productOf(div(top.coefficient, bottom.coefficient), factors);
}

//Python's floor division and modulo and the residue of the least absolute value, for the tests
std::string integersOf(const std::vector<std::string> &names)
{
    if (names.size() != 3) throw MathError(ErrorCode::Argument, "An operation and two integers are expected");
    const Z a(names[1]), b(names[2]);
    if (b == 0) throw MathError(ErrorCode::DivisionByZero, "A division by 0");
    if (names[0] == "floorDiv") return floorDiv(a, b).str();
    if (names[0] == "floorMod") return floorMod(a, b).str();
    if (names[0] == "symmetricMod") return symmetricMod(a, b).str();
    throw MathError(ErrorCode::Argument, "Not an operation of integers: " + names[0]);
}

}

FactoredPolynomial factorPolynomial(const Expr &expression)
{
    const ExprFactors factored = factorsOf(expression, false);
    return FactoredPolynomial{factored.coefficient, factored.factors};
}

Expr productOf(const Expr &coefficient, const std::vector<std::pair<Expr, Expr>> &factors)
{
    RCP<const Number> number = rcp_static_cast<const Number>(coefficient);
    //The bases and their exponents, in the order of SymEngine's products
    map_basic_basic powers;
    const auto put = [&powers](const Expr &base, const Expr &exponent) {
        const auto found = powers.find(base);
        if (found == powers.end()) {
            powers.emplace(base, exponent);
        } else {
            found->second = add(found->second, exponent);
        }
    };
    for (const auto &[factor, exponent] : factors) {
        const bool integral = is_a<Integer>(*exponent);
        if (is_a_Number(*factor) && integral) {
            number = mulnum(number, rcp_static_cast<const Number>(pow(factor, exponent)));
        } else if (is_a<Mul>(*factor) && integral) {
            const Mul &product = down_cast<const Mul &>(*factor);
            number = mulnum(number, rcp_static_cast<const Number>(pow(product.get_coef(), exponent)));
            for (const auto &[base, power] : product.get_dict()) put(base, mul(power, exponent));
        } else if (is_a<Pow>(*factor) && integral) {
            put(down_cast<const Pow &>(*factor).get_base(), mul(down_cast<const Pow &>(*factor).get_exp(), exponent));
        } else {
            put(factor, exponent);
        }
    }
    map_basic_basic dict;
    for (const auto &[base, exponent] : powers) {
        if (is_a_Number(*exponent) && down_cast<const Number &>(*exponent).is_zero()) continue;
        if (!is_a_Number(*base)) {
            dict.emplace(base, exponent);
            continue;
        }
        //A power of a number: a number (sqrt(2) sqrt(2) is 2), or its canonical form (2^(3/2) is 2 sqrt(2))
        const Expr value = pow(base, exponent);
        if (is_a_Number(*value)) {
            number = mulnum(number, rcp_static_cast<const Number>(value));
        } else if (is_a<Mul>(*value)) {
            number = mulnum(number, down_cast<const Mul &>(*value).get_coef());
            for (const auto &[b, e] : down_cast<const Mul &>(*value).get_dict()) dict.emplace(b, e);
        } else if (is_a<Pow>(*value)) {
            dict.emplace(down_cast<const Pow &>(*value).get_base(), down_cast<const Pow &>(*value).get_exp());
        } else {
            dict.emplace(value, one);
        }
    }
    if (dict.empty() || number->is_zero()) return number;
    if (number->is_one() && dict.size() == 1) return pow(dict.begin()->first, dict.begin()->second);
    return make_rcp<const Mul>(number, std::move(dict));
}

Expr sumOf(const std::vector<Expr> &terms)
{
    Expr canonical = zero;
    std::vector<Expr> whole;
    for (const Expr &term : terms) {
        if (is_a<Mul>(*term) && !down_cast<const Mul &>(*term).get_coef()->is_one()) {
            const Mul &product = down_cast<const Mul &>(*term);
            const Expr rebuilt = mul(product.get_coef(), Mul::from_dict(one, map_basic_basic(product.get_dict())));
            if (!eq(*rebuilt, *term)) {
                whole.push_back(term);
                continue;
            }
        }
        canonical = add(canonical, term);
    }
    if (whole.empty()) return canonical;
    //The terms of the canonical sum, and the whole ones with the coefficient 1
    RCP<const Number> coefficient = zero;
    umap_basic_num dict;
    if (is_a<Add>(*canonical)) {
        coefficient = down_cast<const Add &>(*canonical).get_coef();
        dict = down_cast<const Add &>(*canonical).get_dict();
    } else if (is_a_Number(*canonical)) {
        coefficient = rcp_static_cast<const Number>(canonical);
    } else {
        RCP<const Number> c;
        RCP<const Basic> t;
        Add::as_coef_term(canonical, outArg(c), outArg(t));
        dict[t] = c;
    }
    for (const Expr &term : whole) Add::dict_add_term(dict, one, term);
    return Add::from_dict(coefficient, std::move(dict));
}

Expr factoredFraction(const Expr &numerator, const Expr &denominator)
{
    return factoredOf(numerator, denominator, false);
}

PolyResult polyOperation(const std::string &operation, const std::vector<Expr> &expressions, const std::vector<std::string> &names)
{
    PolyResult result;
    const auto need = [&expressions, &operation](std::size_t count) {
        if (expressions.size() != count) throw MathError(ErrorCode::Argument, operation + " takes " + std::to_string(count) + " expressions");
    };
    const auto name = [&names, &operation]() -> const std::string & {
        if (names.empty()) throw MathError(ErrorCode::Argument, operation + " takes a variable");
        return names[0];
    };
    if (operation == "gcd") {
        result.expression = gcdLcmOf(expressions, true);
    } else if (operation == "lcm") {
        result.expression = gcdLcmOf(expressions, false);
    } else if (operation == "resultant") {
        need(2);
        result.expression = resultantOf(expressions[0], expressions[1], name());
    } else if (operation == "discriminant") {
        need(1);
        result.expression = discriminantOf(expressions[0], name());
    } else if (operation == "factorList" || operation == "sqfList") {
        need(1);
        const ExprFactors factored = factorsOf(expressions[0], operation == "sqfList");
        result.expression = factored.coefficient;
        for (const auto &[factor, k] : factored.factors) {
            result.expressions.push_back(factor);
            result.numbers.push_back(static_cast<double>(k));
        }
    } else if (operation == "factor" || operation == "sqf") {
        need(1);
        const std::pair<Expr, Expr> fraction = fractionOf(expressions[0]);
        result.expression = factoredOf(fraction.first, fraction.second, operation == "sqf");
    } else if (operation == "cancel") {
        need(1);
        result.expression = cancelOf(expressions[0]);
    } else if (operation == "together") {
        need(1);
        result.expression = togetherOf(expressions[0]);
    } else if (operation == "apart") {
        need(1);
        result.expression = apartOf(expressions[0], name());
    } else if (operation == "completeSquare") {
        need(1);
        result.expression = completeSquareOf(expressions[0], name());
    } else if (operation == "integers") {
        result.text = integersOf(names);
    } else {
        throw MathError(ErrorCode::Argument, "Not an operation of polynomials: " + operation);
    }
    return result;
}

}
