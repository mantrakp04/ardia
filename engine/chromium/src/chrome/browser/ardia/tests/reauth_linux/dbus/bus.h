#pragma once
#include <map>
#include <memory>
#include <string>
#include "base/task/sequenced_task_runner.h"
#include "dbus/object_path.h"
#include "dbus/object_proxy.h"
namespace dbus {
class Bus {
 public:
  bool connects = true;
  std::string name = ":1.42";
  base::SequencedTaskRunner runner;
  bool Connect() { return connects; }
  std::string GetConnectionName() { return name; }
  base::SequencedTaskRunner* GetDBusTaskRunner() { return &runner; }
  ObjectProxy* GetObjectProxy(const std::string& service, const ObjectPath& path) {
    auto& proxy = proxies_[service + path.value()];
    if (!proxy) proxy = std::make_unique<ObjectProxy>(service, path.value());
    return proxy.get();
  }

 private:
  std::map<std::string, std::unique_ptr<ObjectProxy>> proxies_;
};
}
