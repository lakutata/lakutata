//The square-free decomposition and the factorization of polynomials over the integers, after SymPy's sqfreetools.py
//and factortools.py (BSD-3, its notice in THIRD_PARTY_NOTICES.md): Yun's square-free decomposition; in one variable
//the cyclotomic factors of x^n - 1 and x^n + 1, else Zassenhaus' algorithm (Cantor-Zassenhaus modulo a prime, Hensel
//lifting, the recombination of the factors by subsets of increasing sizes); in several variables Wang's algorithm (the
//enhanced extended Zassenhaus). The random evaluation points of Wang's algorithm come from a fixed sequence.
#pragma once

#include <utility>
#include <vector>

#include "Dense.h"

namespace math {
namespace poly {

//An integer and factors with their multiplicities: each factor primitive, its ground leading coefficient positive
struct Factorization {
    Z coefficient;
    std::vector<std::pair<Dmp, long>> factors;
};

//The factorization over the integers (dmp_factor_list): the content with its sign, the irreducible factors
Factorization dmp_factor_list(const Dmp &f, long u);

//The square-free decomposition over the integers (dmp_sqf_list): the content with its sign, the square-free factors
//of each multiplicity
Factorization dmp_sqf_list(const Dmp &f, long u);

//The square-free part, primitive, its ground leading coefficient positive
Dmp dmp_sqf_part(const Dmp &f, long u);

//Whether a polynomial is square free
bool dmp_sqf_p(const Dmp &f, long u);

}
}
