#include <dirent.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cassert>
#include <cstdio>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>

#include "ardia/linux/ac_linux_config_core.cc"

namespace config = ardia::linux_config;

namespace {

void Write(const std::string& path, const std::string& text) {
  std::ofstream out(path, std::ios::binary | std::ios::trunc);
  out << text;
}

std::string Slurp(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  std::stringstream all;
  all << in.rdbuf();
  return all.str();
}

void AtomicWrite(const std::string& path, const std::string& text) {
  const std::string temp = path + ".swap";
  Write(temp, text);
  assert(rename(temp.c_str(), path.c_str()) == 0);
}

bool Settle(config::Watcher& watcher) {
  bool notified = false;
  pollfd entry{watcher.fd(), POLLIN, 0};
  while (poll(&entry, 1, 250) > 0) notified = watcher.Drain() || notified;
  return notified;
}

bool IsLink(const std::string& path) {
  struct stat info;
  return lstat(path.c_str(), &info) == 0 && S_ISLNK(info.st_mode);
}

void Reads(const std::string& root) {
  const std::string folder = root + "/config";
  assert(mkdir(folder.c_str(), 0755) == 0);
  assert(config::Read(folder, "config.json").status == config::ReadStatus::kMissing);
  Write(folder + "/config.json", "{\"theme\": \"nord\"}");
  const config::FileRead ok = config::Read(folder, "config.json");
  assert(ok.status == config::ReadStatus::kOk && ok.text == "{\"theme\": \"nord\"}");
  assert(config::Read(folder, "config.schema.json").status == config::ReadStatus::kUnreadable);
  assert(config::Read(folder, "themes/../config.json").status == config::ReadStatus::kUnreadable);
  assert(config::Read(folder, "themes/Nord.json").status == config::ReadStatus::kUnreadable);
  assert(config::Read(folder, "themes/-x.json").status == config::ReadStatus::kUnreadable);
  assert(config::Read(folder, "themes/nord.json").status == config::ReadStatus::kMissing);
  assert(mkdir((folder + "/themes").c_str(), 0755) == 0);
  assert(mkdir((folder + "/themes/dir.json").c_str(), 0755) == 0);
  assert(config::Read(folder, "themes/dir.json").status == config::ReadStatus::kNotFile);
  assert(mkfifo((folder + "/themes/fifo.json").c_str(), 0600) == 0);
  assert(config::Read(folder, "themes/fifo.json").status == config::ReadStatus::kNotFile);
  Write(folder + "/themes/exact.json", std::string(config::kReadLimit, 'a'));
  assert(config::Read(folder, "themes/exact.json").status == config::ReadStatus::kOk);
  Write(folder + "/themes/big.json", std::string(config::kReadLimit + 1, 'a'));
  assert(config::Read(folder, "themes/big.json").status == config::ReadStatus::kTooBig);
  Write(folder + "/themes/bytes.json", "{\"a\": \"\xC0\xAF\"}");
  assert(config::Read(folder, "themes/bytes.json").status == config::ReadStatus::kUnreadable);
  Write(folder + "/themes/surrogate.json", "\xED\xA0\x80");
  assert(config::Read(folder, "themes/surrogate.json").status == config::ReadStatus::kUnreadable);
  Write(folder + "/themes/accents.json", "{\"name\": \"caf\xC3\xA9 \xF0\x9F\x8E\xA8\"}");
  assert(config::Read(folder, "themes/accents.json").status == config::ReadStatus::kOk);
  const std::string dots = root + "/dots";
  assert(mkdir(dots.c_str(), 0755) == 0);
  Write(dots + "/linked.json", "{}");
  assert(symlink((dots + "/linked.json").c_str(), (folder + "/themes/linked.json").c_str()) == 0);
  assert(config::Read(folder, "themes/linked.json").status == config::ReadStatus::kOk);
  assert(symlink((dots + "/nowhere.json").c_str(), (folder + "/themes/dangling.json").c_str()) == 0);
  assert(config::Read(folder, "themes/dangling.json").status == config::ReadStatus::kMissing);
  assert(chmod((folder + "/themes/exact.json").c_str(), 0) == 0);
  if (geteuid() != 0) assert(config::Read(folder, "themes/exact.json").status == config::ReadStatus::kUnreadable);
}

void Schemas(const std::string& root) {
  const std::string data = root + "/data";
  const std::string folder = data + "/config";
  const std::string schemas = data + "/config-schema";
  assert(mkdir(data.c_str(), 0755) == 0);
  const std::map<std::string, std::string> files = {
      {"config.schema.json", "{\"c\": 1}"}, {"theme.schema.json", "{\"t\": 1}"}, {"../escape.json", "x"}, {"config.json", "x"}};
  config::SchemaWrite first = config::WriteSchemas(schemas, folder, files);
  assert(first.error.empty());
  assert(first.written.size() == 2);
  assert(Slurp(schemas + "/config.schema.json") == "{\"c\": 1}");
  assert(access((data + "/escape.json").c_str(), F_OK) != 0);
  assert(access((schemas + "/config.json").c_str(), F_OK) != 0);
  assert(access(folder.c_str(), F_OK) != 0);
  assert(config::WriteSchemas(schemas, folder, files).written.empty());
  assert(mkdir(folder.c_str(), 0755) == 0);
  const std::string outside = root + "/outside.json";
  Write(outside, "keep");
  assert(symlink(outside.c_str(), (folder + "/theme.schema.json").c_str()) == 0);
  config::SchemaWrite second = config::WriteSchemas(schemas, folder, files);
  assert(second.error.empty());
  assert(second.written.size() == 2);
  assert(second.written[0] == folder + "/config.schema.json");
  assert(!IsLink(folder + "/theme.schema.json"));
  assert(Slurp(folder + "/theme.schema.json") == "{\"t\": 1}");
  assert(Slurp(outside) == "keep");
  config::SchemaWrite changed = config::WriteSchemas(schemas, folder, {{"config.schema.json", "{\"c\": 2}"}});
  assert(changed.written.size() == 2);
  assert(Slurp(schemas + "/config.schema.json") == "{\"c\": 2}");
  for (const std::string& dir : {schemas, folder}) {
    std::unique_ptr<DIR, int (*)(DIR*)> listing(opendir(dir.c_str()), closedir);
    while (dirent* entry = readdir(listing.get())) assert(std::string(entry->d_name).find(".tmp") == std::string::npos);
  }
  Write(data + "/blocked", "");
  config::SchemaWrite failed = config::WriteSchemas(data + "/blocked/config-schema", folder, files);
  assert(!failed.error.empty());
}

void Watches(const std::string& root) {
  const std::string data = root + "/data";
  const std::string folder = data + "/config";
  assert(mkdir(data.c_str(), 0755) == 0);
  config::Watcher watcher(folder);
  assert(watcher.fd() >= 0);
  watcher.SetNames({"config.json", "themes/nord.json", "../escape", "config.schema.json"});
  Write(data + "/Local State", "{}");
  assert(!Settle(watcher));
  assert(mkdir(folder.c_str(), 0755) == 0);
  assert(Settle(watcher));
  Write(folder + "/config.json", "{}");
  assert(Settle(watcher));
  AtomicWrite(folder + "/config.json", "{\"theme\": \"nord\"}");
  assert(Settle(watcher));
  Write(folder + "/config.schema.json", "{}");
  Write(folder + "/notes.txt", "x");
  assert(!Settle(watcher));
  assert(mkdir((folder + "/themes").c_str(), 0755) == 0);
  assert(Settle(watcher));
  Write(folder + "/themes/nord.json", "{}");
  assert(Settle(watcher));
  Write(folder + "/themes/other.json", "{}");
  assert(!Settle(watcher));
  const std::string dots = root + "/dots";
  assert(mkdir(dots.c_str(), 0755) == 0);
  assert(mkdir((dots + "/themes").c_str(), 0755) == 0);
  Write(dots + "/themes/nord.json", "{}");
  assert(unlink((folder + "/themes/nord.json").c_str()) == 0);
  assert(unlink((folder + "/themes/other.json").c_str()) == 0);
  assert(rmdir((folder + "/themes").c_str()) == 0);
  assert(symlink((dots + "/themes").c_str(), (folder + "/themes").c_str()) == 0);
  assert(Settle(watcher));
  Write(dots + "/themes/nord.json", "{\"dark\": {}}");
  assert(Settle(watcher));
  Write(dots + "/themes/other.json", "{}");
  assert(!Settle(watcher));
  watcher.SetNames({"config.json"});
  Write(dots + "/themes/nord.json", "{}");
  assert(!Settle(watcher));
  const std::string elsewhere = root + "/elsewhere";
  assert(mkdir(elsewhere.c_str(), 0755) == 0);
  Write(elsewhere + "/config.json", "{}");
  assert(rename(folder.c_str(), (data + "/config.old").c_str()) == 0);
  assert(Settle(watcher));
  assert(symlink(elsewhere.c_str(), folder.c_str()) == 0);
  assert(Settle(watcher));
  assert(watcher.watched_directories().contains(elsewhere));
  Write(elsewhere + "/config.json", "{\"theme\": null}");
  assert(Settle(watcher));
  Write(data + "/config.old/config.json", "{}");
  assert(!Settle(watcher));
  watcher.SetNames({});
  Write(elsewhere + "/config.json", "{}");
  assert(!Settle(watcher));
}

}

void Links(const std::string& root) {
  const std::string data = root + "/data";
  const std::string dots = root + "/dots";
  const std::string folder = data + "/config";
  for (const std::string& dir : {data, dots, dots + "/release-a", dots + "/release-a/ardia", dots + "/release-b",
                                 dots + "/release-b/ardia"}) {
    assert(mkdir(dir.c_str(), 0755) == 0);
  }
  assert(symlink((dots + "/release-a").c_str(), (dots + "/current").c_str()) == 0);
  assert(symlink((dots + "/current/ardia").c_str(), folder.c_str()) == 0);
  Write(dots + "/release-a/ardia/config.json", "{}");
  Write(dots + "/release-b/ardia/config.json", "{}");
  config::Watcher watcher(folder);
  watcher.SetNames({"config.json", "themes/nord.json"});
  Write(dots + "/release-a/ardia/config.json", "{\"a\": 1}");
  assert(Settle(watcher));
  assert(symlink((dots + "/release-b").c_str(), (dots + "/next").c_str()) == 0);
  assert(rename((dots + "/next").c_str(), (dots + "/current").c_str()) == 0);
  assert(Settle(watcher));
  Write(dots + "/release-a/ardia/config.json", "{\"a\": 2}");
  assert(!Settle(watcher));
  Write(dots + "/release-b/ardia/config.json", "{\"b\": 1}");
  assert(Settle(watcher));
  const std::string themes = dots + "/release-b/ardia/themes";
  assert(mkdir(themes.c_str(), 0755) == 0);
  assert(Settle(watcher));
  assert(symlink((dots + "/later/nord.json").c_str(), (themes + "/nord.json").c_str()) == 0);
  assert(Settle(watcher));
  assert(mkdir((dots + "/later").c_str(), 0755) == 0);
  assert(Settle(watcher));
  Write(dots + "/later/nord.json", "{}");
  assert(Settle(watcher));
  Write(dots + "/later/nord.json", "{\"dark\": {}}");
  assert(Settle(watcher));
  Write(dots + "/later/other.json", "{}");
  assert(!Settle(watcher));
  const std::string blocked = root + "/blocked";
  config::Watcher files(blocked + "/config");
  assert(mkdir(blocked.c_str(), 0755) == 0);
  assert(mkdir((blocked + "/config").c_str(), 0755) == 0);
  assert(mkdir((blocked + "/config/themes").c_str(), 0755) == 0);
  Write(root + "/plain", "x");
  assert(symlink((root + "/plain/../dots/later/nord.json").c_str(), (blocked + "/config/themes/up.json").c_str()) == 0);
  assert(symlink((root + "/plain/").c_str(), (blocked + "/config/themes/slash.json").c_str()) == 0);
  assert(config::Read(blocked + "/config", "themes/up.json").status == config::ReadStatus::kMissing);
  files.SetNames({"themes/up.json", "themes/slash.json"});
  assert(!files.watched_directories().contains(dots + "/later"));
  assert(files.watched_directories().contains(root));
  assert(unlink((root + "/plain").c_str()) == 0);
  assert(mkdir((root + "/plain").c_str(), 0755) == 0);
  assert(Settle(files));
  assert(files.watched_directories().contains(dots + "/later"));
  Write(dots + "/later/nord.json", "{\"light\": {}}");
  assert(Settle(files));
  const std::string locked = root + "/locked";
  assert(mkdir(locked.c_str(), 0755) == 0);
  assert(mkdir((locked + "/inner").c_str(), 0755) == 0);
  Write(locked + "/inner/nord.json", "{}");
  assert(symlink((locked + "/inner/nord.json").c_str(), (blocked + "/config/themes/locked.json").c_str()) == 0);
  assert(chmod((locked + "/inner").c_str(), 0600) == 0);
  config::Watcher permissions(blocked + "/config");
  permissions.SetNames({"themes/locked.json"});
  assert(chmod((locked + "/inner").c_str(), 0755) == 0);
  if (geteuid() != 0) {
    assert(Settle(permissions));
    assert(permissions.watched_directories().contains(locked + "/inner"));
    Write(locked + "/inner/nord.json", "{\"dark\": {}}");
    assert(Settle(permissions));
  }
  const std::string waiting = root + "/waiting";
  config::Watcher dangling(waiting + "/config");
  assert(mkdir(waiting.c_str(), 0755) == 0);
  assert(symlink((root + "/elsewhere/ardia").c_str(), (waiting + "/config").c_str()) == 0);
  dangling.SetNames({"config.json"});
  assert(mkdir((root + "/elsewhere").c_str(), 0755) == 0);
  assert(mkdir((root + "/elsewhere/ardia").c_str(), 0755) == 0);
  assert(Settle(dangling));
  Write(root + "/elsewhere/ardia/config.json", "{}");
  assert(Settle(dangling));
}

int main(int argc, char** argv) {
  assert(argc == 3);
  const std::string scenario = argv[1];
  const std::string root = argv[2];
  if (scenario == "reads") Reads(root);
  else if (scenario == "schemas") Schemas(root);
  else if (scenario == "watches") Watches(root);
  else if (scenario == "links") Links(root);
  else return 2;
  return 0;
}
