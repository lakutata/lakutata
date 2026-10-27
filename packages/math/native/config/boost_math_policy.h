// The policy of Boost.Math in the addon (the special functions of real arguments in SymEngine's evaluations, the
// statistics and the distributions of math.stats): no exceptions, a value outside the domain, a pole, an overflow or a
// series that does not converge giving NaN or an infinity, as the C library does; doubles computed in doubles (promoted
// to long double, they would differ in their last digits by platform, and Linux on arm64 computes long double in
// software); the quantile of a discrete distribution as the smallest k of cdf(k) >= p, as SciPy's ppf.
#pragma once

#ifndef BOOST_MATH_STANDALONE
#define BOOST_MATH_STANDALONE
#endif

#include <boost/math/policies/policy.hpp>

namespace lakutata {

using BoostPolicy = boost::math::policies::policy<
    boost::math::policies::domain_error<boost::math::policies::ignore_error>,
    boost::math::policies::pole_error<boost::math::policies::ignore_error>,
    boost::math::policies::overflow_error<boost::math::policies::ignore_error>,
    boost::math::policies::evaluation_error<boost::math::policies::ignore_error>,
    boost::math::policies::rounding_error<boost::math::policies::ignore_error>,
    boost::math::policies::promote_float<false>,
    boost::math::policies::promote_double<false>,
    boost::math::policies::discrete_quantile<boost::math::policies::integer_round_up>>;

}
