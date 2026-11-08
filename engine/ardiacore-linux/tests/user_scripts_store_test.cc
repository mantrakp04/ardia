#include <dirent.h>
#include <fcntl.h>
#include <stdlib.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cassert>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

#include "ardia/linux/ac_linux_user_scripts_store.cc"

namespace scripts = ardia::linux_user_scripts;

namespace {

void Write(const std::string& path, const std::string& text) {
  FILE* file = fopen(path.c_str(), "w");
  assert(file);
  fwrite(text.data(), 1, text.size(), file);
  fclose(file);
}

std::string Real(const std::string& path) {
  char resolved[PATH_MAX];
  assert(realpath(path.c_str(), resolved));
  return resolved;
}

scripts::Folder ReadWith(const std::string& root, std::optional<std::string> verdict, std::string* seen = nullptr) {
  return scripts::Read(root, [&](int fd, const std::string& manifest) {
    assert(fd >= 0);
    if (seen) *seen = manifest;
    return verdict;
  });
}

void Expect(const scripts::Folder& folder, const std::string& state, std::optional<int64_t> generation,
            const std::optional<std::string>& error = std::nullopt) {
  if (folder.state != state || folder.generation != generation || folder.error != error) {
    fprintf(stderr, "got %s %lld %s, wanted %s %lld %s\n", folder.state.c_str(),
            static_cast<long long>(folder.generation.value_or(-999)), folder.error.value_or("-").c_str(),
            state.c_str(), static_cast<long long>(generation.value_or(-999)), error.value_or("-").c_str());
    abort();
  }
}

void Parse() {
  assert(scripts::ParseGeneration("3\n") == 3);
  assert(scripts::ParseGeneration("  42 ") == 42);
  assert(scripts::ParseGeneration("+7") == 7);
  assert(scripts::ParseGeneration("-2") == -2);
  assert(scripts::ParseGeneration("9223372036854775807") == INT64_MAX);
  assert(scripts::ParseGeneration("-9223372036854775808") == INT64_MIN);
  assert(!scripts::ParseGeneration("9223372036854775808"));
  assert(!scripts::ParseGeneration(""));
  assert(!scripts::ParseGeneration("\n"));
  assert(!scripts::ParseGeneration("+"));
  assert(!scripts::ParseGeneration("1 2"));
  assert(!scripts::ParseGeneration("0x10"));
  assert(!scripts::ParseGeneration("3.0"));
}

void States(const std::string& root) {
  const std::string folder = root + "/Scripts";
  const std::string path = Real(root) + "/Scripts/extension";
  scripts::Folder first = ReadWith(root, std::nullopt);
  Expect(first, "empty", std::nullopt);
  assert(!first.path && !first.token.empty());
  struct stat info;
  assert(lstat(folder.c_str(), &info) == 0 && S_ISDIR(info.st_mode));
  assert(lstat((folder + "/.lock").c_str(), &info) == 0 && S_ISREG(info.st_mode));

  Write(folder + "/generation", "3\n");
  scripts::Folder absent = ReadWith(root, std::nullopt);
  Expect(absent, "absent", 3);
  assert(absent.path == path);

  assert(mkdir((folder + "/extension").c_str(), 0755) == 0);
  Expect(ReadWith(root, std::nullopt), "pending", std::nullopt);
  Write(folder + "/extension/generation", "2\n");
  Expect(ReadWith(root, std::nullopt), "pending", 3);
  Write(folder + "/extension/generation", "4\n");
  Expect(ReadWith(root, std::nullopt), "invalid", 4, "manifest.json is missing or isn't a plain file");

  Write(root + "/elsewhere.json", "{}");
  assert(symlink((root + "/elsewhere.json").c_str(), (folder + "/extension/manifest.json").c_str()) == 0);
  Expect(ReadWith(root, std::nullopt), "invalid", 4, "manifest.json is missing or isn't a plain file");
  assert(unlink((folder + "/extension/manifest.json").c_str()) == 0);

  Write(folder + "/extension/manifest.json", std::string(scripts::kManifestLimit + 1, ' '));
  Expect(ReadWith(root, std::nullopt), "invalid", 4, "manifest.json is too large");

  Write(folder + "/extension/manifest.json", "{\"manifest_version\": 3}");
  std::string seen;
  scripts::Folder ready = ReadWith(root, std::nullopt, &seen);
  Expect(ready, "ready", 4);
  assert(ready.path == path && seen == "{\"manifest_version\": 3}");
  Expect(ReadWith(root, "refused"), "invalid", 4, "refused");

  const std::string before = ready.token;
  Write(folder + "/extension/generation", "5\n");
  assert(ReadWith(root, std::nullopt).token != before);

  assert(rename((folder + "/extension").c_str(), (root + "/real-extension").c_str()) == 0);
  assert(symlink((root + "/real-extension").c_str(), (folder + "/extension").c_str()) == 0);
  Expect(ReadWith(root, std::nullopt), "invalid", 3, "Scripts/extension isn't a plain folder");
  assert(unlink((folder + "/extension").c_str()) == 0);

  assert(rename(folder.c_str(), (root + "/real-scripts").c_str()) == 0);
  assert(symlink((root + "/real-scripts").c_str(), folder.c_str()) == 0);
  Expect(ReadWith(root, std::nullopt), "invalid", 0, "Scripts isn't a plain folder");
}

void Files(const std::string& root) {
  const std::string ext = root + "/ext";
  assert(mkdir(ext.c_str(), 0755) == 0);
  assert(mkdir((ext + "/lib").c_str(), 0755) == 0);
  Write(ext + "/a.js", "a");
  Write(ext + "/lib/b.js", "b");
  Write(root + "/outside.js", "x");
  assert(symlink((root + "/outside.js").c_str(), (ext + "/link.js").c_str()) == 0);
  assert(symlink((ext + "/lib").c_str(), (ext + "/linked").c_str()) == 0);
  const int fd = open(ext.c_str(), O_RDONLY | O_DIRECTORY);
  assert(fd >= 0);
  const std::string at = "content_scripts[0].js";
  assert(!scripts::CheckFile(fd, "a.js", at));
  assert(!scripts::CheckFile(fd, "lib/b.js", at));
  auto plain = [&](std::string_view relative) {
    return at + ": \"" + std::string(relative) + "\" must be a plain relative path inside the extension";
  };
  for (const std::string_view bad : {"", "/a.js", "a.js/", "./a.js", "../outside.js", "lib//b.js", "lib\\b.js"}) {
    assert(scripts::CheckFile(fd, bad, at) == plain(bad));
  }
  assert(scripts::CheckFile(fd, std::string_view("a\0b", 3), at) == plain(std::string_view("a\0b", 3)));
  assert(scripts::CheckFile(fd, "missing.js", at) == at + ": \"missing.js\" is missing");
  assert(scripts::CheckFile(fd, "link.js", at) == at + ": \"link.js\" must be a plain file, not a link");
  assert(scripts::CheckFile(fd, "linked/b.js", at) == at + ": \"linked/b.js\" must be a plain file, not a link");
  assert(scripts::CheckFile(fd, "lib", at) == at + ": \"lib\" must be a plain file, not a link");
  assert(scripts::CheckFile(fd, "a.js/b.js", at) == at + ": \"a.js/b.js\" must be a plain file, not a link");
  close(fd);
}

void Lock(const std::string& root) {
  const std::string folder = root + "/Scripts";
  assert(mkdir(folder.c_str(), 0755) == 0);
  const int held = open((folder + "/.lock").c_str(), O_RDWR | O_CREAT, 0600);
  assert(held >= 0 && flock(held, LOCK_EX) == 0);
  std::thread release([held] {
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    flock(held, LOCK_UN);
  });
  const auto start = std::chrono::steady_clock::now();
  Expect(ReadWith(root, std::nullopt), "empty", std::nullopt);
  const auto waited = std::chrono::steady_clock::now() - start;
  release.join();
  close(held);
  assert(waited >= std::chrono::milliseconds(250));
  assert(waited < std::chrono::seconds(5));
}

void Fifo(const std::string& root) {
  const std::string folder = root + "/Scripts";
  assert(mkdir(folder.c_str(), 0755) == 0);
  assert(mkfifo((folder + "/.lock").c_str(), 0644) == 0);
  alarm(5);
  Expect(ReadWith(root, std::nullopt), "busy", std::nullopt);
  alarm(0);
}

void AsciiToken(const std::string& root) {
  const std::string folder = root + "/Scripts";
  assert(mkdir(folder.c_str(), 0755) == 0);
  Write(folder + "/generation", "\xff\xfe\n");
  const std::string first = ReadWith(root, std::nullopt).token;
  for (const unsigned char c : first) assert(c >= 0x20 && c < 0x7f);
  Write(folder + "/generation", "\xff\xfd\n");
  const std::string second = ReadWith(root, std::nullopt).token;
  for (const unsigned char c : second) assert(c >= 0x20 && c < 0x7f);
  assert(first != second);
  for (const unsigned char c : scripts::Signature(root)) assert(c >= 0x20 && c < 0x7f);
}

void Status(const std::string& root) {
  umask(022);
  assert(!scripts::ReadStatus(root));
  assert(!scripts::WriteStatus(root, "{\"generation\":1}"));
  assert(scripts::ReadStatus(root) == "{\"generation\":1}");
  const std::string status = root + "/Scripts/status.json";
  struct stat info;
  assert(lstat(status.c_str(), &info) == 0 && S_ISREG(info.st_mode) && (info.st_mode & 0777) == 0644);

  assert(unlink(status.c_str()) == 0);
  Write(root + "/target.json", "secret");
  assert(symlink((root + "/target.json").c_str(), status.c_str()) == 0);
  assert(!scripts::ReadStatus(root));
  assert(!scripts::WriteStatus(root, "{\"generation\":2}"));
  assert(lstat(status.c_str(), &info) == 0 && S_ISREG(info.st_mode));
  assert(scripts::ReadStatus(root) == "{\"generation\":2}");
  FILE* target = fopen((root + "/target.json").c_str(), "r");
  char text[16] = {};
  assert(target && fread(text, 1, sizeof(text) - 1, target) == 6);
  fclose(target);
  assert(std::string(text) == "secret");

  assert(scripts::WriteStatus(root, std::string(scripts::kStatusLimit + 1, ' ')) == "status.json is too large");
  Write(status, std::string(scripts::kStatusLimit + 1, ' '));
  assert(!scripts::ReadStatus(root));

  DIR* dir = opendir((root + "/Scripts").c_str());
  assert(dir);
  int entries = 0;
  while (dirent* entry = readdir(dir)) {
    const std::string name = entry->d_name;
    if (name == "." || name == "..") continue;
    assert(name == "status.json");
    ++entries;
  }
  closedir(dir);
  assert(entries == 1);

  const std::string moved = root + "/moved";
  assert(rename((root + "/Scripts").c_str(), moved.c_str()) == 0);
  assert(symlink(moved.c_str(), (root + "/Scripts").c_str()) == 0);
  assert(scripts::WriteStatus(root, "{}") == "Scripts isn't a plain folder");
  assert(!scripts::ReadStatus(root));
}

void Uncreatable(const std::string& root) {
  const std::string locked = root + "/locked";
  assert(mkdir(locked.c_str(), 0555) == 0);
  const std::string denied = std::string("Couldn't create Scripts: ") + strerror(EACCES);
  scripts::Folder folder = ReadWith(locked, std::nullopt);
  Expect(folder, "invalid", 0, denied);
  assert(folder.path == Real(locked) + "/Scripts/extension");
  assert(scripts::WriteStatus(locked, "{}") == denied);
  const std::string missing = std::string("Couldn't create Scripts: ") + strerror(ENOENT);
  Expect(ReadWith(root + "/gone", std::nullopt), "invalid", 0, missing);
  assert(scripts::WriteStatus(root + "/gone", "{}") == missing);
  assert(chmod(locked.c_str(), 0755) == 0);
  Expect(ReadWith(locked, std::nullopt), "empty", std::nullopt);
  assert(!scripts::WriteStatus(locked, "{}"));
  assert(scripts::ReadStatus(locked) == "{}");
}

void Signature(const std::string& root) {
  const std::string folder = root + "/Scripts";
  assert(mkdir(folder.c_str(), 0755) == 0);
  const std::string empty = scripts::Signature(root);
  assert(empty == "-|-");
  assert(scripts::Signature(root) == empty);
  Write(folder + "/generation", "1\n");
  const std::string written = scripts::Signature(root);
  assert(written != empty);
  assert(mkdir((folder + "/extension").c_str(), 0755) == 0);
  const std::string published = scripts::Signature(root);
  assert(published != written);
  Write(folder + "/extension/generation", "1\n");
  Write(folder + "/status.json", "{}");
  assert(scripts::Signature(root) == published);
  assert(mkdir((folder + "/staged").c_str(), 0755) == 0);
  assert(rename((folder + "/extension").c_str(), (folder + "/old").c_str()) == 0);
  assert(rename((folder + "/staged").c_str(), (folder + "/extension").c_str()) == 0);
  assert(scripts::Signature(root) != published);
}

}

int main(int argc, char** argv) {
  assert(argc >= 2);
  const std::string name = argv[1];
  if (name == "parse") Parse();
  else if (name == "states") States(argv[2]);
  else if (name == "files") Files(argv[2]);
  else if (name == "lock") Lock(argv[2]);
  else if (name == "status") Status(argv[2]);
  else if (name == "fifo") Fifo(argv[2]);
  else if (name == "ascii-token") AsciiToken(argv[2]);
  else if (name == "signature") Signature(argv[2]);
  else if (name == "uncreatable") Uncreatable(argv[2]);
  else return 2;
  return 0;
}
