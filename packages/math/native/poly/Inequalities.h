//The real solutions of an inequality of a fraction of polynomials in one variable with rational coefficients, as a
//union of intervals and points of exact ends. The factors of the numerator and of the denominator over the integers
//give the points where the sign can change: a linear factor its rational root, another irreducible factor its real
//roots isolated (RealRoots.h) and matched with the exact roots solve() finds for it. The intervals are refined until
//they are apart, and the sign between two roots is computed exactly at a rational point. The zeros of a denominator
//(also of a fraction inside the expression: 1/(1 + 1/x) is not defined at 0) are never solutions.
#pragma once

#include <string>

#include "../core/Handle.h"
#include "../ops/Operations.h"

namespace math {

//The solutions of expression < 0 (relation "<"), <= 0, > 0 or >= 0 for a variable in the real numbers: kind
//"intervals", "finite" (points only) or "empty"; the isolated points in values, the intervals ((-inf, inf) for every
//real number)
Solutions inequalityOf(const Expr &expression, const std::string &relation, const std::string &variable);

}
