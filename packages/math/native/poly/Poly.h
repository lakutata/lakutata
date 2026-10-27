//The operations of math.poly on expressions: gcd, lcm, resultant, discriminant. Over the integers when all the
//coefficients are integers (the gcd of the contents in a gcd, the leading coefficient positive), over the rationals
//otherwise (monic), as SymPy's gcd, lcm, resultant and discriminant; numbers alone have the gcd and the lcm of numbers
//(of rationals: gcd(1/2, 1/3) is 1/6)
#pragma once

#include <string>
#include <vector>

#include "../core/Handle.h"

namespace math {

struct PolyResult {
    Expr expression;
    std::vector<Expr> expressions;
    std::vector<double> numbers;
    std::string text;
};

//The factorization over the rationals of a polynomial: its rational coefficient, its irreducible factors (primitive,
//their leading coefficients positive) and their multiplicities, by their total degrees then their texts
struct FactoredPolynomial {
    Expr coefficient;
    std::vector<std::pair<Expr, long>> factors;
};

FactoredPolynomial factorPolynomial(const Expr &expression);

//An operation by its name: its expressions, and names (the variable of a resultant or a discriminant)
PolyResult polyOperation(const std::string &operation, const std::vector<Expr> &expressions, const std::vector<std::string> &names);

}
