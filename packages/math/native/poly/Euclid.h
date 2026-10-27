//The greatest common divisors, least common multiples, resultants and discriminants of polynomials over the
//integers, after SymPy's euclidtools.py (BSD-3, its notice in THIRD_PARTY_NOTICES.md): the heuristic gcd (GCDHEU),
//falling back to the subresultant PRS; the resultant by the subresultant PRS, with the sign (-1)^(mn) when the first
//polynomial has the lower degree (SymPy leaves it out)
#pragma once

#include <vector>

#include "Dense.h"

namespace math {
namespace poly {

//A gcd and the cofactors: f = h cff, g = h cfg
struct Cofactors {
    Dmp h;
    Dmp cff;
    Dmp cfg;
};

//The subresultant PRS of two polynomials of the level u, and its scalar subdeterminants (of the level u - 1; at the
//level 0 polynomials of one coefficient)
void dmp_inner_subresultants(const Dmp &f, const Dmp &g, long u, std::vector<Dmp> &R, std::vector<Dmp> &S);

//The resultant in the first variable (the level u - 1; at the level 0 a polynomial of one coefficient)
Dmp dmp_resultant(const Dmp &f, const Dmp &g, long u);

//The discriminant in the first variable: (-1)^(n(n - 1)/2) res(f, f')/lc(f) (the level u - 1)
Dmp dmp_discriminant(const Dmp &f, long u);

//The content (the gcd of the coefficients in the first variable, of the level u - 1, its ground leading coefficient
//positive) and the primitive part
Dmp dmp_content(const Dmp &f, long u);
Dmp dmp_primitive(const Dmp &f, long u, Dmp &content);

//The gcd and the cofactors: over the integers, the gcd of the contents in it, its ground leading coefficient positive
Cofactors dmp_inner_gcd(const Dmp &f, const Dmp &g, long u);
Dmp dmp_gcd(const Dmp &f, const Dmp &g, long u);

//The lcm: the lcm of the contents in it, its ground leading coefficient positive
Dmp dmp_lcm(const Dmp &f, const Dmp &g, long u);

}
}
