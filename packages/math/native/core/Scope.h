//A scope of definitions: the functions and constants defined by formulas (f(x) = x^2 + 1, g = 9.80665), compiled once
//when the scope is made, never changed after (a scope shared by several users cannot be changed by one of them). A
//scope made with() another one adds definitions over its, which can replace them.
#pragma once

#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "../parser/Parser.h"

namespace math {

class Scope {
public:
    //Make a scope: its definitions as signatures (f(x, y), g) and bodies, over a parent scope or none
    static std::shared_ptr<const Scope> make(std::shared_ptr<const Scope> parent, const std::vector<std::pair<std::string, std::string>> &definitions);

    //The definition of a name, in this scope or its parents
    const Definition *find(const std::string &name) const;

    //A resolver of the parser over this scope
    Resolver resolver() const;

    //The definitions of this scope (not its parents'): their names and signatures
    const std::vector<std::pair<std::string, std::string>> &signatures() const;

private:
    std::shared_ptr<const Scope> parent_;
    std::map<std::string, Definition> definitions_;
    std::vector<std::pair<std::string, std::string>> signatures_;
};

}
