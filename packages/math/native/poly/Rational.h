//Fractions of polynomials, after SymPy's cancel (polytools.py, dmp_cancel in euclidtools.py), together
//(rationaltools.py) and apart (partfrac.py, the undetermined coefficients) (BSD-3, its notice in THIRD_PARTY_NOTICES.md),
//and the completed square of a quadratic polynomial. The fractions are written as factor() writes its products, the
//number in front ((x + 1)/(2x), not (x/2 + 1/2)/x).
#pragma once

#include <string>

#include "../core/Handle.h"

namespace math {

//A fraction with its numerator and its denominator divided by their gcd, both expanded, their leading coefficients
//positive (the sign in front): (2x^2 - 2)/(x^2 - 2x + 1) is (2x + 2)/(x - 1). Its generators are those of math.poly.
Expr cancelOf(const Expr &expression);

//Whether cancel() removes a factor that is not a number, and then the result (the integrand of numeric.integrate)
bool cancelled(const Expr &expression, Expr &result);

//The expression over one denominator: the bases of the denominators to their greatest powers, the lcm of their
//numbers (1/(2x) + 1/(3y) is (2x + 3y)/(6x y)), the numerator expanded, nothing cancelled; inside sums, products and
//powers, not inside the arguments of functions
Expr togetherOf(const Expr &expression);

//The partial fractions in a variable: the polynomial part, and for each irreducible factor q^k of the denominator the
//fractions h_j/q^j (j = 1 to k) of the numerators h_j of degrees lower than q's, each one factored. The other variables
//are parameters; a function of the variable (sin(x)) is not supported
Expr apartOf(const Expr &expression, const std::string &variable);

//A polynomial of degree 2 in a variable, a x^2 + b x + c, as a(x + b/(2a))^2 + c - b^2/(4a)
Expr completeSquareOf(const Expr &expression, const std::string &variable);

}
