#include "ac_pip_hyprland.h"

#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <utility>

namespace ardia::pip_linux {
namespace {

using Clock = std::chrono::steady_clock;

bool Wait(int fd, short events, Clock::time_point deadline) {
  while (Clock::now() < deadline) {
    pollfd descriptor{fd, events, 0};
    const int remaining = std::max(
        1,
        static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(
                             deadline - Clock::now())
                             .count()));
    const int result = poll(&descriptor, 1, remaining);
    if (result > 0) {
      return descriptor.revents & (events | POLLHUP);
    }
    if (result == 0 || errno != EINTR) {
      return false;
    }
  }
  return false;
}

bool SafeComponent(const std::string& value) {
  return !value.empty() &&
         std::all_of(value.begin(), value.end(), [](unsigned char c) {
           return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                  (c >= '0' && c <= '9') || c == '_' || c == '-';
         });
}

}

Connection::Connection(int fd) : fd_(fd) {}
Connection::Connection(Connection&& other)
    : fd_(std::exchange(other.fd_, -1)) {}
Connection& Connection::operator=(Connection&& other) {
  std::swap(fd_, other.fd_);
  return *this;
}
Connection::~Connection() {
  if (fd_ >= 0) {
    close(fd_);
  }
}

std::optional<std::string> HyprlandSocketPath(const std::string& runtime,
                                              const std::string& signature) {
  if (runtime.empty() || runtime[0] != '/' || !SafeComponent(signature)) {
    return std::nullopt;
  }
  return runtime + "/hypr/" + signature + "/.socket.sock";
}

Connection ConnectHyprland(const std::string& path) {
  sockaddr_un address{};
  if (path.empty() || path.size() >= sizeof(address.sun_path)) {
    return Connection();
  }
  Connection connection(
      socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0));
  if (!connection) {
    return connection;
  }
  address.sun_family = AF_UNIX;
  std::memcpy(address.sun_path, path.c_str(), path.size() + 1);
  const int result = connect(
      connection.get(), reinterpret_cast<sockaddr*>(&address), sizeof(address));
  if (result < 0) {
    if (errno != EINPROGRESS ||
        !Wait(connection.get(), POLLOUT,
              Clock::now() + std::chrono::milliseconds(100))) {
      return Connection();
    }
    int error = 0;
    socklen_t length = sizeof(error);
    if (getsockopt(connection.get(), SOL_SOCKET, SO_ERROR, &error, &length) <
            0 ||
        error) {
      return Connection();
    }
  }
  ucred peer{};
  socklen_t length = sizeof(peer);
  if (getsockopt(connection.get(), SOL_SOCKET, SO_PEERCRED, &peer, &length) <
          0 ||
      peer.uid != geteuid()) {
    return Connection();
  }
  return connection;
}

std::optional<std::string> RequestHyprland(const std::string& path,
                                           const std::string& request) {
  Connection connection = ConnectHyprland(path);
  if (!connection ||
      send(connection.get(), request.data(), request.size(), MSG_NOSIGNAL) !=
          static_cast<ssize_t>(request.size())) {
    return std::nullopt;
  }
  const auto deadline = Clock::now() + std::chrono::milliseconds(100);
  std::string result;
  char buffer[4096];
  while (result.size() < 1024 * 1024 &&
         Wait(connection.get(), POLLIN, deadline)) {
    const ssize_t count = recv(connection.get(), buffer, sizeof(buffer), 0);
    if (count == 0) {
      return result;
    }
    if (count > 0) {
      result.append(buffer, static_cast<size_t>(count));
    } else if (errno != EAGAIN && errno != EINTR) {
      break;
    }
  }
  return std::nullopt;
}

void SendHyprland(Connection connection, const std::string& command) {
  if (connection && !command.empty()) {
    send(connection.get(), command.data(), command.size(),
         MSG_DONTWAIT | MSG_NOSIGNAL);
  }
}

std::string PlacementCommand(const std::string& identity,
                             int pid,
                             const Rectangle& observed) {
  if (!SafeComponent(identity) || pid <= 0 || observed.width <= 0 ||
      observed.height <= 0) {
    return {};
  }
  return "eval for _,w in ipairs(hl.get_windows()) do "
         "if w.class=='" +
         identity + "' and w.pid==" + std::to_string(pid) +
         " and w.mapped and w.floating and not w.hidden then "
         "local p,s,m=w.at,w.size,w.monitor; "
         "if m and p.x==" +
         std::to_string(observed.x) +
         " and p.y==" + std::to_string(observed.y) +
         " and s.x==" + std::to_string(observed.width) +
         " and s.y==" + std::to_string(observed.height) +
         " then local mw,mh=m.width/m.scale,m.height/m.scale; "
         "if m.transform%2==1 then mw,mh=mh,mw end; "
         "local r=m.reserved; local l,t=m.x+r.left,m.y+r.top; "
         "local right,bottom=m.x+mw-r.right,m.y+mh-r.bottom; "
         "if s.x<=right-l and s.y<=bottom-t and "
         "(p.x<l or p.y<t or p.x+s.x>right or p.y+s.y>bottom) then "
         "local "
         "ix,iy=math.min(10,(right-l-s.x)/2),math.min(10,(bottom-t-s.y)/2); "
         "local x=math.max(l+ix,math.min(p.x,right-ix-s.x)); "
         "local y=math.max(t+iy,math.min(p.y,bottom-iy-s.y)); "
         "hl.dispatch(hl.dsp.window.move({window=w,x=x,y=y})) "
         "end end end end";
}

}
