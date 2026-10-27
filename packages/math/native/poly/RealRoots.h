//The real roots of a polynomial over the integers isolated in intervals of rational ends, by Collins and Akritas'
//bisection with Descartes' rule of signs (our own code): the roots in (0, B) of the polynomial scaled to (0, 1),
//counted by the sign variations of (x + 1)^n f(1/(x + 1)), the interval halved (Taylor shifts) until each part has none
//or one; the negative roots the same way in f(-x). For a square-free polynomial without rational roots (an
//irreducible factor of degree 2 or more): no end of an interval is ever a root.
#pragma once

#include <vector>

#include <symengine/rational.h>

#include "Dense.h"

namespace math {
namespace poly {

using Q = SymEngine::rational_class;

//An open interval (a, b) with one root of the polynomial inside, where it changes its sign
struct RootInterval {
    Q a;
    Q b;
};

//The isolating intervals of the real roots of a square-free polynomial without rational roots, from the lowest root
std::vector<RootInterval> dup_isolate_real_roots(const Dup &f);

//The sign of a polynomial at a rational point: -1, 0 or 1
int dup_sign_at(const Dup &f, const Q &x);

//The interval of a root halved, toward the root
void dup_refine_root(const Dup &f, RootInterval &interval);

}
}
