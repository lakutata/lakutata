/*
 * The configuration of SymEngine in @lakutata/math, in place of the one CMake writes from symengine_config.h.in: the
 * integers and rationals of Boost.Multiprecision (no GMP), atomic reference counts (the addon uses SymEngine from its
 * threads), RTTI. Kept in step with vendor/symengine/symengine (scripts/sync.mjs).
 */
#ifndef SYMENGINE_CONFIG_HPP
#define SYMENGINE_CONFIG_HPP

#define SYMENGINE_MAJOR_VERSION 0
#define SYMENGINE_MINOR_VERSION 15
#define SYMENGINE_PATCH_VERSION 0
#define SYMENGINE_VERSION "0.15.0"

#define WITH_SYMENGINE_RCP
#define WITH_SYMENGINE_THREAD_SAFE
#define HAVE_SYMENGINE_BOOST

#define HAVE_DEFAULT_CONSTRUCTORS
#define HAVE_SYMENGINE_NOEXCEPT
#define HAVE_SYMENGINE_IS_CONSTRUCTIBLE
#define HAVE_SYMENGINE_RESERVE
#define HAVE_SYMENGINE_STD_TO_STRING
#define HAVE_SYMENGINE_RTTI 1

#define SYMENGINE_GMPXX 0
#define SYMENGINE_PIRANHA 1
#define SYMENGINE_FLINT 2
#define SYMENGINE_GMP 3
#define SYMENGINE_BOOSTMP 4

#define SYMENGINE_INTEGER_CLASS SYMENGINE_BOOSTMP

/* Not used by SymEngine outside of this file */
#define SYMENGINE_SIZEOF_LONG_DOUBLE 16

#ifdef HAVE_SYMENGINE_NOEXCEPT
#  define SYMENGINE_NOEXCEPT noexcept
#else
#  define SYMENGINE_NOEXCEPT
#endif

#include <symengine/symengine_export.h>

#endif
