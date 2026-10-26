//The output of the expressions: as the formulas are written (x^2 - 5x + 6: the terms by decreasing degree, the
//implicit products the parser reads back the same), and as LaTeX
#pragma once

#include <string>

#include "../core/Handle.h"

namespace math {

//The text of an expression, which the parser reads back as the same expression
std::string toText(const Expr &expression);

//The LaTeX of an expression
std::string toTeX(const Expr &expression);

//The code of an expression in JavaScript (c false) or in C99: its real value computed with doubles
std::string toCode(const Expr &expression, bool c);

//The text of a double: the shortest that reads back as the same double
std::string doubleText(double value);

}
