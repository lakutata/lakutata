//The piecewise expressions (piecewise(x^2, x < 0, x)): their conditions, decided where both sides of a comparison are
//constants (SymEngine decides the comparisons of two numbers only: sqrt(2) < 3/2 stays), and nan where no case holds,
//which the evaluations append as a last case (they need one whose condition is true)
#pragma once

#include <string>
#include <vector>

#include <symengine/logic.h>

#include "../core/Handle.h"

namespace math {

//A comparison of two values in a condition: "<", "<=", ">", ">=", "=", "!=" (of complex numbers: MathDomainException)
SymEngine::RCP<const SymEngine::Boolean> relationOf(const std::string &relation, const Expr &a, const Expr &b);

//A condition decided: 1 true, 0 false, -1 not known (a comparison with variables, or of values too close to tell)
int decidedOf(const SymEngine::RCP<const SymEngine::Boolean> &condition);

//A piecewise expression with its conditions decided where they can be (piecewise() drops the false ones, ends at a
//true one, and is nan where no case remains); the same expression where none is decided
Expr settledOf(const Expr &piecewise);

//The piecewise parts of an expression with their neighbouring cases of the same value joined (their conditions by or),
//a case of the value of the last, true one dropped: the derivative of step(x) is 0, not piecewise(0, x < 0, 0, x = 0, 0)
Expr mergedOf(const Expr &expression);

//The value of a piecewise expression of constants: of its first case that holds, nan where none does; a condition
//that cannot be decided before it is an error (MathNotSupportedException)
Expr caseOf(const SymEngine::Basic &piecewise);

//The expression with nan as the value where no case holds, in each of its piecewise parts
Expr withOtherwise(const Expr &expression);

//The real values of a variable where a condition of the piecewise parts of an expression can change: the real roots
//of its comparisons as equations (left - right = 0), those solve() finds, sorted
std::vector<double> breakpointsOf(const Expr &expression, const std::string &variable);

}
