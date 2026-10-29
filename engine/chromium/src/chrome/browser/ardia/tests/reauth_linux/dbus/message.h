#pragma once
#include <cstdint>
#include <string>
#include <utility>
#include <vector>
namespace dbus {
struct Node {
  enum class Kind { kBool, kUint32, kString, kVariantString, kStruct, kArray, kDictEntry };
  Kind kind;
  bool flag = false;
  uint32_t number = 0;
  std::string text;
  std::vector<Node> children;
};
class Message {
 public:
  std::vector<Node> body;
  std::string error_name;
  std::string GetErrorName() const { return error_name; }
};
class MethodCall : public Message {
 public:
  MethodCall(std::string interface, std::string member) : interface(std::move(interface)), member(std::move(member)) {}
  std::string interface;
  std::string member;
};
class Response : public Message {};
class ErrorResponse : public Message {};
class MessageWriter {
 public:
  explicit MessageWriter(Message* message) : target_(message ? &message->body : nullptr) {}
  void AppendString(const std::string& value) { Push({Node::Kind::kString, false, 0, value, {}}); }
  void AppendUint32(uint32_t value) { Push({Node::Kind::kUint32, false, value, {}, {}}); }
  void AppendVariantOfString(const std::string& value) { Push({Node::Kind::kVariantString, false, 0, value, {}}); }
  void OpenStruct(MessageWriter* sub) { Open(Node::Kind::kStruct, sub); }
  void OpenArray(const std::string& signature, MessageWriter* sub) {
    Open(Node::Kind::kArray, sub);
    target_->back().text = signature;
  }
  void OpenDictEntry(MessageWriter* sub) { Open(Node::Kind::kDictEntry, sub); }
  void CloseContainer(MessageWriter* sub) { sub->target_ = nullptr; }

 private:
  void Push(Node node) { target_->push_back(std::move(node)); }
  void Open(Node::Kind kind, MessageWriter* sub) {
    Push({kind, false, 0, {}, {}});
    sub->target_ = &target_->back().children;
  }
  std::vector<Node>* target_;
};
class MessageReader {
 public:
  explicit MessageReader(Message* message) : nodes_(message ? &message->body : nullptr) {}
  bool HasMoreData() { return nodes_ && position_ < nodes_->size(); }
  bool PopBool(bool* value) {
    const Node* node = Next(Node::Kind::kBool);
    if (node) *value = node->flag;
    return node;
  }
  bool PopString(std::string* value) {
    const Node* node = Next(Node::Kind::kString);
    if (node) *value = node->text;
    return node;
  }
  bool PopStruct(MessageReader* sub) { return Enter(Node::Kind::kStruct, sub); }
  bool PopArray(MessageReader* sub) { return Enter(Node::Kind::kArray, sub); }
  bool PopDictEntry(MessageReader* sub) { return Enter(Node::Kind::kDictEntry, sub); }

 private:
  const Node* Next(Node::Kind kind) {
    if (!HasMoreData() || (*nodes_)[position_].kind != kind) return nullptr;
    return &(*nodes_)[position_++];
  }
  bool Enter(Node::Kind kind, MessageReader* sub) {
    const Node* node = Next(kind);
    if (!node) return false;
    sub->nodes_ = &node->children;
    sub->position_ = 0;
    return true;
  }
  const std::vector<Node>* nodes_;
  size_t position_ = 0;
};
}
