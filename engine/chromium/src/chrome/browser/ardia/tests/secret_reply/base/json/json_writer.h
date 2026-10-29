#pragma once
#include <cstdio>
#include <string>
#include "base/values.h"

namespace base {

class JSONWriter {
 public:
  static bool Write(const Value& node, std::string* json) {
    json->clear();
    if (json->capacity() < 1024) json->reserve(1024);
    return Build(node, json);
  }

 private:
  static void Escape(const std::string& text, std::string* json) {
    json->push_back('"');
    for (unsigned char c : text) {
      if (c == '"' || c == '\\') {
        json->push_back('\\');
        json->push_back(static_cast<char>(c));
      } else if (c < 32) {
        char escaped[8];
        std::snprintf(escaped, sizeof(escaped), "\\u%04X", c);
        json->append(escaped);
      } else {
        json->push_back(static_cast<char>(c));
      }
    }
    json->push_back('"');
  }

  static bool Build(const Value& node, std::string* json) {
    switch (node.type()) {
      case Value::Type::NONE: json->append("null"); return true;
      case Value::Type::BOOLEAN: json->append(node.GetBool() ? "true" : "false"); return true;
      case Value::Type::INTEGER: json->append(std::to_string(node.GetInt())); return true;
      case Value::Type::STRING: Escape(node.GetString(), json); return true;
      case Value::Type::DICT: {
        json->push_back('{');
        bool first = true;
        for (const auto& [key, child] : node.GetDict()) {
          if (!first) json->push_back(',');
          first = false;
          Escape(key, json);
          json->push_back(':');
          Build(child, json);
        }
        json->push_back('}');
        return true;
      }
      case Value::Type::LIST: {
        json->push_back('[');
        bool first = true;
        for (const Value& child : node.GetList()) {
          if (!first) json->push_back(',');
          first = false;
          Build(child, json);
        }
        json->push_back(']');
        return true;
      }
      case Value::Type::DOUBLE:
      case Value::Type::BINARY: return false;
    }
    return false;
  }
};

}
