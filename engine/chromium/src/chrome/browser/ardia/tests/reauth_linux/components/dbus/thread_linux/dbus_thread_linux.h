#pragma once
#include <memory>
#include "dbus/bus.h"
namespace dbus_thread_linux {
inline std::shared_ptr<dbus::Bus> system_bus = std::make_shared<dbus::Bus>();
inline std::shared_ptr<dbus::Bus> GetSharedSystemBus() { return system_bus; }
}
