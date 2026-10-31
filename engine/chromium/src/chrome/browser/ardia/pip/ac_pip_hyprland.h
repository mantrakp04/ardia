#ifndef CHROME_BROWSER_ARDIA_PIP_AC_PIP_HYPRLAND_H_
#define CHROME_BROWSER_ARDIA_PIP_AC_PIP_HYPRLAND_H_

#include <optional>
#include <string>

namespace ardia::pip_linux {

class Connection {
 public:
  Connection() = default;
  explicit Connection(int fd);
  Connection(Connection&& other);
  Connection& operator=(Connection&& other);
  ~Connection();
  int get() const { return fd_; }
  explicit operator bool() const { return fd_ >= 0; }

 private:
  int fd_ = -1;
};

struct Rectangle {
  int x;
  int y;
  int width;
  int height;
  bool operator==(const Rectangle&) const = default;
};

std::optional<std::string> HyprlandSocketPath(const std::string& runtime,
                                              const std::string& signature);
Connection ConnectHyprland(const std::string& path);
std::optional<std::string> RequestHyprland(const std::string& path,
                                           const std::string& request);
void SendHyprland(Connection connection, const std::string& command);
std::string PlacementCommand(const std::string& identity,
                             int pid,
                             const Rectangle& observed);

}

#endif
