//The integrals of expressions, after SymPy's integrals/manualintegrate.py (BSD-3, its notice in THIRD_PARTY_NOTICES.md):
//an antiderivative without a constant, by the partial fractions of the rational functions, a table of the elementary
//functions of a linear argument (and of square roots of quadratics), substitution, integration by parts, the powers and
//products of sines and cosines, the substitution u = e^x; each one checked by its derivative at points. A definite
//integral from an antiderivative and limits at the ends, split at the poles inside the interval. The Laplace transform
//and its inverse, after SymPy's integrals/laplace.py (its tables and rules).
#pragma once

#include <string>

#include "../core/Handle.h"

namespace math {

//An antiderivative of an expression in a variable (1/x gives ln(x), as in SymPy), or MathNotSupportedException
Expr antiderivativeOf(const Expr &expression, const std::string &variable);

//The integral from one value to another (inf and -inf too): inf or -inf where it grows without end, MathDomainException
//where it has no value (inf - inf, a pole inside where it diverges), MathNotSupportedException where no antiderivative
//is found
Expr definiteIntegralOf(const Expr &expression, const std::string &variable, const Expr &from, const Expr &to);

//The Laplace transform of an expression of t, an expression of s: by a table (powers of t, exponentials, sines and
//cosines, their hyperbolic ones) and the rules of linearity, of e^(a t) (a shift in s) and of t^n (the derivatives in
//s); without the conditions of convergence, as SymPy with noconds; MathNotSupportedException where it is not found
Expr laplaceOf(const Expr &expression, const std::string &t, const std::string &s);

//The inverse Laplace transform, an expression of t for t > 0: of fractions of polynomials in s by their partial
//fractions, of powers of s - a, of e^(-c s) F(s) as F's inverse from t = c; checked by its transform
Expr inverseLaplaceOf(const Expr &expression, const std::string &s, const std::string &t);

}
