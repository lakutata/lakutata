/*
 * The export macros of SymEngine in @lakutata/math, in place of the ones CMake's GenerateExportHeader writes: SymEngine
 * is compiled into the addon, nothing is exported from it.
 */
#ifndef SYMENGINE_EXPORT_H
#define SYMENGINE_EXPORT_H

#define SYMENGINE_EXPORT
#define SYMENGINE_NO_EXPORT

#ifdef _MSC_VER
#  define SYMENGINE_DEPRECATED __declspec(deprecated)
#else
#  define SYMENGINE_DEPRECATED __attribute__((__deprecated__))
#endif
#define SYMENGINE_DEPRECATED_EXPORT SYMENGINE_EXPORT SYMENGINE_DEPRECATED
#define SYMENGINE_DEPRECATED_NO_EXPORT SYMENGINE_NO_EXPORT SYMENGINE_DEPRECATED

#endif
