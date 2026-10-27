//Gosper's algorithm for the sums of hypergeometric terms, after SymPy's concrete/gosper.py (BSD-3, its notice in
//THIRD_PARTY_NOTICES.md): a term f(k) whose ratio f(k + 1)/f(k) is a fraction of polynomials in k (the factors of the
//term: k-free bases to exponents linear in k, polynomials and gammas of linear arguments to integer powers; factorials
//and binomial coefficients are gammas) has a hypergeometric antidifference T(k) = f(k) g(k), with g a fraction of
//polynomials, when the equation of Gosper's normal form has a polynomial solution; the sum from a to b is then
//f(b) (g(b) + 1) - f(a) g(a).
#pragma once

#include <optional>

#include <symengine/symbol.h>

#include "../core/Handle.h"

namespace math {

//The sum of a term for its variable from low to high (not inf) by Gosper's algorithm, or nothing
std::optional<Expr> gosperSum(const Expr &term, const SymEngine::RCP<const SymEngine::Symbol> &index, const Expr &low, const Expr &high);

}
