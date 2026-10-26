//The handles of the addon: the native objects JavaScript holds (an expression, a scope of definitions, a compiled
//function), each an External tagged with its type, released when JavaScript collects it, its memory told to V8
#pragma once

#include <napi.h>
#include <memory>
#include <symengine/basic.h>

#include "Errors.h"

namespace math {

using Expr = SymEngine::RCP<const SymEngine::Basic>;

//The type tags of the handles: a handle of one type given where another is expected is an error, not a crash
extern const napi_type_tag EXPRESSION_TAG;
extern const napi_type_tag SCOPE_TAG;
extern const napi_type_tag COMPILED_TAG;
extern const napi_type_tag TOKEN_TAG;

//The subexpressions of a node, without building new ones: the terms of a sum, the bases and the exponents of a product
//(get_args() makes a product of each term of a sum, a power of each factor of a product)
void childrenOf(const SymEngine::Basic &node, std::vector<const SymEngine::Basic *> &children);

//The approximate native memory of an expression: told to V8 so that it collects the handles of large ones in time
size_t expressionMemory(const Expr &expression);

//The deepest expressions: the operations recurse through them, in the threads of JavaScript too (4 MiB of stack in a
//worker thread)
constexpr unsigned MAX_DEPTH = 1000;

//Throws MathError (NotSupported) for an expression deeper than MAX_DEPTH (the definitions composed in each other can
//build one, sharing its subexpressions)
void checkDepth(const Expr &expression);

//A handle of a native object, owned by a shared_ptr (the threads of the addon may hold it too)
template <typename T>
struct Handle {
    std::shared_ptr<T> value;
    int64_t memory;
};

template <typename T>
Napi::Value wrap(Napi::Env env, std::shared_ptr<T> value, const napi_type_tag &tag, int64_t memory)
{
    auto *handle = new Handle<T>{std::move(value), memory};
    Napi::External<Handle<T>> external = Napi::External<Handle<T>>::New(env, handle, [](Napi::Env env, Handle<T> *finalized) {
        Napi::MemoryManagement::AdjustExternalMemory(env, -finalized->memory);
        delete finalized;
    });
    external.TypeTag(&tag);
    Napi::MemoryManagement::AdjustExternalMemory(env, memory);
    return external;
}

template <typename T>
std::shared_ptr<T> unwrap(const Napi::Value &value, const napi_type_tag &tag, const char *what)
{
    if (!value.IsExternal() || !value.As<Napi::External<Handle<T>>>().CheckTypeTag(&tag)) {
        throw MathError(ErrorCode::Argument, std::string("Not ") + what);
    }
    return value.As<Napi::External<Handle<T>>>().Data()->value;
}

//An expression given to JavaScript
Napi::Value wrapExpression(Napi::Env env, const Expr &expression);

//The expression of a handle
Expr unwrapExpression(const Napi::Value &value);

}
