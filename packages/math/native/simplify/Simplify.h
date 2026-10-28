//The simplification of expressions (simplify()): of the forms an expression can take by identities that hold for all
//values (fractions cancelled; exponentials of multiples of one argument as powers of one exponential; sines and cosines
//of multiples of one angle reduced by sin^2 + cos^2 = 1, and written with double angles or tangents, the hyperbolic
//ones by cosh^2 - sinh^2 = 1; nested square roots of numbers taken apart, square roots of numbers out of denominators;
//logarithms of positive rationals combined), the shortest by the number of operations. Nothing that needs to know the
//signs of the variables (sqrt(x^2) is not x).
#pragma once

#include "../core/Handle.h"

namespace math {

//The shortest form found of an expression: the expression itself where no form is shorter; the arguments of its
//functions simplified first, the conditions of piecewise expressions and the sums and products left as they are
Expr simplifiedOf(const Expr &expression);

//The number of operations of an expression, as SymPy's count_ops counts them (each addition, subtraction, product,
//division, sign, power and function): the measure of simplify()
unsigned long measureOf(const Expr &expression);

}
