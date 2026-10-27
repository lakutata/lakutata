//Expressions as polynomials over the integers and back. The generators of several expressions, expanded, are found as
//SymPy's decompose_power finds them: a factor b^n of an integer n is n times b; b^(p/q) is p times b^(1/q); b^(c t) of a
//rational c = p/q is p times b^(t/q) (exp(2x) is exp(x) twice); any other factor (a symbol, sin(x), sqrt(2), pi) is a
//generator once. The generators are ordered: the symbols by their names, then the others by their text. The rational
//coefficients are made integers by the lcm of their denominators. A negative power, a complex or an inexact
//coefficient is not a polynomial (MathNotSupportedException).
#pragma once

#include <string>
#include <vector>

#include "../core/Handle.h"
#include "Dense.h"

namespace math {
namespace poly {

//Expressions as polynomials: their common generators (the first one first in the polynomials), the polynomials (of the
//level u: the number of generators minus 1, 0 without any), the denominator of each (the expression is the polynomial
//divided by it) and whether one of them is not an integer
struct Polynomials {
    std::vector<Expr> generators;
    std::vector<Dmp> polys;
    std::vector<Z> denominators;
    long u = 0;
    bool rational = false;
};

//Expressions as polynomials in their common generators; a variable named first is the first generator (it is one even
//where the expressions do not have it)
Polynomials toPolynomials(const std::vector<Expr> &expressions, const std::string &first = "");

//The expression of a polynomial of the level u in generators, divided by a denominator
Expr fromPolynomial(const Dmp &f, long u, const std::vector<Expr> &generators, const Z &denominator = Z(1));

//The expression of a polynomial over the rationals made monic: divided by its ground leading coefficient
Expr monicPolynomial(const Dmp &f, long u, const std::vector<Expr> &generators);

}
}
