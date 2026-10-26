//The number theory of the integers (math.ntheory): primality, factorization, modular arithmetic, the integer sequences
//and the combinatorial numbers, on the integers of SymEngine (Boost.Multiprecision). SymEngine's factorization sieves
//up to the square root of the number, of no use for a large one: the primality test and the factorization are ours.
#pragma once

#include <string>
#include <vector>

#include <symengine/mp_class.h>

#include "../core/Handle.h"

namespace math {

using Integer = SymEngine::integer_class;

//What an operation of the number theory gives: one of these kinds, the values holding it
struct NumberTheoryResult {
    enum class Kind {
        //integers[0]
        Integer,
        //flag
        Boolean,
        //sign: -1, 0 or 1
        Sign,
        //integers: prime, exponent, prime, exponent…
        Factors,
        //expression: an exact rational number
        Rational,
        //integers: [gcd, x, y], [remainder, modulus]
        Integers,
        //no such value (undefined in JavaScript)
        Missing
    };
    Kind kind = Kind::Missing;
    std::vector<Integer> integers;
    bool flag = false;
    int sign = 0;
    Expr expression;
};

//An operation by its name, on its arguments: each argument a list of integers (of one integer for a single one)
NumberTheoryResult numberTheoryOf(const std::string &operation, const std::vector<std::vector<Integer>> &arguments);

//Whether an integer is a prime: deterministic below 2^64; above, the Baillie-PSW test, which no known composite number
//passes
bool isPrime(const Integer &n);

}
