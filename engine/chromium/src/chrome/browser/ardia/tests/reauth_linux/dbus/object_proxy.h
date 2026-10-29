#pragma once
#include <string>
#include <utility>
#include <vector>
#include "base/functional/callback.h"
#include "dbus/message.h"
#include "dbus/object_path.h"
namespace dbus {
struct SentCall {
  std::string service;
  std::string path;
  std::string interface;
  std::string member;
  std::vector<Node> body;
  int timeout_ms;
  base::OnceCallback<void(Response*, ErrorResponse*)> reply;
};
inline std::vector<SentCall> sent_calls;
class ObjectProxy {
 public:
  enum { TIMEOUT_USE_DEFAULT = -1 };
  using ResponseOrErrorCallback = base::OnceCallback<void(Response*, ErrorResponse*)>;
  ObjectProxy(std::string service, std::string path) : service_(std::move(service)), path_(std::move(path)) {}
  void CallMethodWithErrorResponse(MethodCall* call, int timeout_ms, ResponseOrErrorCallback callback) {
    sent_calls.push_back({service_, path_, call->interface, call->member, call->body, timeout_ms, std::move(callback)});
  }

 private:
  std::string service_;
  std::string path_;
};
}
