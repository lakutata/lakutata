//The operations of math.poly on expressions (see Poly.h)
#include "Poly.h"

#include <symengine/integer.h>
#include <symengine/rational.h>

#include "../core/Errors.h"
#include "../parser/Parser.h"
#include "Convert.h"
#include "Euclid.h"

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
    } else if (operation == "integers") {
        result.text = integersOf(names);
    } else {
        throw MathError(ErrorCode::Argument, "Not an operation of polynomials: " + operation);
    }
    return result;
}

}
