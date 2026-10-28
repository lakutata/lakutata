//The limits of expressions, by Gruntz's algorithm after SymPy's series/gruntz.py (BSD-3, its notice in
//THIRD_PARTY_NOTICES.md): a limit at a point is one at inf (z0 + 1/z from above, z0 - 1/z from below, -z for -inf);
//at inf, the most rapidly varying subexpressions (mrv) of the expression are rewritten as powers of one of them, w,
//which goes to 0, and the leading term c0 w^e0 of the expression in w gives the limit: 0 for e0 > 0, an infinity of
//the sign of c0 for e0 < 0, the limit of c0 for e0 = 0. The variable is real, going to inf; w is positive, and log(w)
//is a symbol in the series in w (SymEngine has no logarithmic series).
#pragma once

#include <string>

#include <symengine/symbol.h>

#include "../core/Handle.h"

namespace math {

//The limit of an expression for a variable going to a point (inf and -inf too) from above ("+"), from below ("-") or
//from both sides ("both": the same limit, or MathDomainException); an infinity where it diverges
Expr limitOf(const Expr &expression, const std::string &variable, const Expr &point, const std::string &direction);

//limitOf() for a symbol (the variables of the algorithms of the addon)
Expr limitOf(const Expr &expression, const SymEngine::RCP<const SymEngine::Symbol> &variable, const Expr &point, const std::string &direction);

}
