#include "Handle.h"

#include <algorithm>
#include <unordered_map>

#include "Errors.h"

namespace math {

//Random 128-bit tags, one by type of handle
const napi_type_tag EXPRESSION_TAG = {0x6c616b7574617461ULL, 0x6d61746845787072ULL};
const napi_type_tag SCOPE_TAG = {0x6c616b7574617461ULL, 0x6d61746853636f70ULL};
const napi_type_tag COMPILED_TAG = {0x6c616b7574617461ULL, 0x6d617468436f6d70ULL};
const napi_type_tag TOKEN_TAG = {0x6c616b7574617461ULL, 0x6d617468546f6b6eULL};

size_t expressionMemory(const Expr &expression)
{
    //The node and its arguments: a cheap estimate, deep enough for the sums and the products of many terms
    size_t memory = 96;
    for (const Expr &argument : expression->get_args()) memory += 96 + 32 * argument->get_args().size();
    return memory;
}

void checkDepth(const Expr &expression)
{
    //Without recursion, the height of each subexpression with arguments computed once (the expression is a graph)
    struct Frame {
        const SymEngine::Basic *node;
        SymEngine::vec_basic arguments;
        size_t next;
        unsigned height;
    };
    std::unordered_map<const SymEngine::Basic *, unsigned> heights;
    std::vector<Frame> path;
    const auto deeper = [&path](unsigned below) {
        if (path.size() + below > MAX_DEPTH) throw MathError(ErrorCode::NotSupported, "The expression is nested more than " + std::to_string(MAX_DEPTH) + " levels deep");
    };
    path.push_back({expression.get(), expression->get_args(), 0, 0});
    while (!path.empty()) {
        Frame &frame = path.back();
        if (frame.next == frame.arguments.size()) {
            const unsigned height = frame.height;
            heights.emplace(frame.node, height);
            path.pop_back();
            if (!path.empty()) path.back().height = std::max(path.back().height, height + 1);
            continue;
        }
        const Expr &argument = frame.arguments[frame.next++];
        if (argument->get_args().empty()) {
            frame.height = std::max(frame.height, 1u);
            continue;
        }
        const auto known = heights.find(argument.get());
        if (known != heights.end()) {
            deeper(known->second + 1);
            frame.height = std::max(frame.height, known->second + 1);
            continue;
        }
        deeper(1);
        path.push_back({argument.get(), argument->get_args(), 0, 0});
    }
}

Napi::Value wrapExpression(Napi::Env env, const Expr &expression)
{
    checkDepth(expression);
    return wrap(env, std::make_shared<Expr>(expression), EXPRESSION_TAG, static_cast<int64_t>(expressionMemory(expression)));
}

Expr unwrapExpression(const Napi::Value &value)
{
    return *unwrap<Expr>(value, EXPRESSION_TAG, "an expression");
}

}
