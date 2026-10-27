//The operations of math.poly on expressions: gcd, lcm, resultant, discriminant, the factorizations, and the
//operations on fractions of polynomials (Rational.h). Over the integers when all the
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

//A product of a number and factors to their powers as factor() writes it, the number in front (3(x + 1)(y + 2),
//(x + 1)/(2x)): SymEngine's product would multiply the number into the first sum. The numbers among the factors and the
//numbers of the products go to the coefficient, the powers of the same base are added
Expr productOf(const Expr &coefficient, const std::vector<std::pair<Expr, Expr>> &factors);

//A sum of terms, a product of productOf() among them kept whole where SymEngine's sum would write it again (its number
//multiplied into a sum: -(x - 2)/(3(x^2 - x + 1)) as (-x + 2)/(3x^2 - 3x + 3))
Expr sumOf(const std::vector<Expr> &terms);

//A fraction factored as factor() factors it: its numerator and its denominator, their common factors cancelled
Expr factoredFraction(const Expr &numerator, const Expr &denominator);

//An operation by its name: its expressions, and names (the variable of a resultant or a discriminant)
PolyResult polyOperation(const std::string &operation, const std::vector<Expr> &expressions, const std::vector<std::string> &names);

}
