#include <cassert>
#include <cstdio>
#include <initializer_list>
#include <string>

#include "ardia/linux/ac_linux_downloads.h"
#include "ardia/linux/ac_linux_file_drop.h"

using namespace ardia::linux_downloads;

namespace {

base::DictValue Dict(std::initializer_list<std::pair<const char*, base::Value>> entries) {
  base::DictValue dict;
  for (const auto& [key, value] : entries) dict.Set(key, value.Clone());
  return dict;
}

void Ids() {
  assert(ValidDownloadId("3f2504e0-4f89-41d3-9a0c-0305e82c3301"));
  assert(ValidDownloadId("3F2504E0-4F89-41D3-9A0C-0305E82C3301"));
  assert(!ValidDownloadId(""));
  assert(!ValidDownloadId("3f2504e0-4f89-41d3-9a0c-0305e82c330"));
  assert(!ValidDownloadId("3f2504e0-4f89-41d3-9a0c-0305e82c33011"));
  assert(!ValidDownloadId("3f2504e04-f89-41d3-9a0c-0305e82c3301"));
  assert(!ValidDownloadId("3f2504e0-4f89-41d3-9a0c-0305e82c330g"));
  assert(!ValidDownloadId("saved-0"));
  assert(!ValidDownloadId("../../../../etc/passwd-aaaa-bbbb-cccc"));
  assert(!ValidDownloadId(std::string("3f2504e0-4f89-41d3-9a0c-0305e82c330\0", 36)));
}

void Paths() {
  assert(ValidLocalPath("/home/me/Downloads/report.pdf"));
  assert(ValidLocalPath("/"));
  assert(!ValidLocalPath(""));
  assert(!ValidLocalPath("relative/file"));
  assert(!ValidLocalPath("/home/me/../root"));
  assert(!ValidLocalPath("/home/./me"));
  assert(!ValidLocalPath("/home//me"));
  assert(!ValidLocalPath("/home/me/"));
  assert(!ValidLocalPath(std::string("/home/me\0/x", 11)));
  assert(!ValidLocalPath("/" + std::string(kMaxPathBytes, 'a')));
  assert(ValidLocalPath("/home/me/..hidden"));
  assert(BaseName("/home/me/a b.txt") == "a b.txt");
  assert(FileUrl("/tmp/a b#?%.txt") == "file:///tmp/a%20b%23%3F%25.txt");
  assert(FileUrl("/tmp/\xc3\xa9t\xc3\xa9") == "file:///tmp/%C3%A9t%C3%A9");
  assert(PathListed("/d/a.txt", {"/d/b.txt", "/d/a.txt"}));
  assert(!PathListed("/d/c.txt", {"/d/b.txt", "/d/a.txt"}));
  assert(!PathListed("/d/../d/a.txt", {"/d/../d/a.txt"}));
  assert(!PathListed("", {""}));
}

void Requests() {
  const std::string id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  for (const char* verb : {"downloads.cancel", "downloads.pause", "downloads.resume", "downloads.keep", "downloads.remove"}) {
    assert(ValidateRequest(verb, Dict({{"id", base::Value(id)}})).empty());
    assert(!ValidateRequest(verb, Dict({})).empty());
    assert(!ValidateRequest(verb, Dict({{"id", base::Value("saved-3")}})).empty());
    assert(!ValidateRequest(verb, Dict({{"id", base::Value(7)}})).empty());
    assert(!ValidateRequest(verb, Dict({{"id", base::Value(id)}, {"path", base::Value("/etc/passwd")}})).empty());
  }
  assert(ValidateRequest("downloads.list", Dict({})).empty());
  assert(!ValidateRequest("downloads.list", Dict({{"all", base::Value(true)}})).empty());
  assert(ValidateRequest("downloads.settings", Dict({})).empty());
  assert(ValidateRequest("downloads.setSettings", Dict({{"folder", base::Value("/home/me/Downloads")}})).empty());
  assert(ValidateRequest("downloads.setSettings", Dict({{"askWhereToSave", base::Value(false)}})).empty());
  assert(ValidateRequest("downloads.setSettings", Dict({})).empty());
  assert(!ValidateRequest("downloads.setSettings", Dict({{"folder", base::Value("Downloads")}})).empty());
  assert(!ValidateRequest("downloads.setSettings", Dict({{"folder", base::Value("/home/me/../../etc")}})).empty());
  assert(!ValidateRequest("downloads.setSettings", Dict({{"askWhereToSave", base::Value("yes")}})).empty());
  assert(!ValidateRequest("downloads.setSettings", Dict({{"managed", base::Value(false)}})).empty());
  assert(ValidateRequest("history.query", Dict({{"anything", base::Value(1)}})).empty());
}

base::Value Entry(const std::string& id, std::optional<bool> off_the_record) {
  base::DictValue entry = Dict({{"id", base::Value(id)}, {"path", base::Value("/d/" + id)}});
  if (off_the_record) entry.Set("offTheRecord", base::Value(*off_the_record));
  return base::Value(std::move(entry));
}

void Snapshots() {
  const std::string a = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const std::string b = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
  const std::string c = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
  base::ListValue list;
  list.Append(Entry(a, std::nullopt));
  list.Append(Entry(b, true));
  list.Append(Entry(c, false));
  list.Append(Entry("saved-1", false));
  list.Append(base::Value("not an entry"));
  base::DictValue reply;
  reply.Set("downloads", base::Value(std::move(list)));
  const auto filtered = FilterSnapshot(base::Value(std::move(reply)));
  assert(filtered && filtered->size() == 2);
  assert(*(*filtered)[0].GetDict().FindString("id") == a);
  assert(*(*filtered)[1].GetDict().FindString("id") == c);
  assert(!FilterSnapshot(base::Value("x")));
  assert(!FilterSnapshot(base::Value(Dict({{"downloads", base::Value(7)}}))));
  base::ListValue mixed;
  mixed.Append(Entry(a, std::nullopt));
  mixed.Append(Entry(b, true));
  mixed.Append(Entry(c, false));
  base::DictValue mixed_reply;
  mixed_reply.Set("downloads", base::Value(std::move(mixed)));
  const base::Value both(std::move(mixed_reply));
  const auto regular = FilterSnapshot(both, false);
  assert(regular && regular->size() == 2);
  const auto off_the_record = FilterSnapshot(both, true);
  assert(off_the_record && off_the_record->size() == 1 && *(*off_the_record)[0].GetDict().FindString("id") == b);
}

void Routes() {
  using ardiacore::linux_profiles::ProfileError;
  using ardiacore::linux_profiles::ProfileKind;
  auto route = [](ProfileKind kind, bool page_private, bool ending, bool hosts) {
    return RouteDownloads(kind, page_private, ending, hosts);
  };
  auto regular = route(ProfileKind::kDefault, false, false, false);
  assert(regular.error == ProfileError::kNone && !regular.off_the_record);
  auto isolated = route(ProfileKind::kIsolated, false, false, true);
  assert(isolated.error == ProfileError::kNone && !isolated.off_the_record);
  assert(route(ProfileKind::kIsolated, false, false, false).error == ProfileError::kWindowMismatch);
  assert(route(ProfileKind::kIsolated, true, false, false).error == ProfileError::kWindowMismatch);
  auto own_private = route(ProfileKind::kPrivate, true, false, true);
  assert(own_private.error == ProfileError::kNone && own_private.off_the_record);
  auto this_private_window = route(ProfileKind::kDefault, true, false, false);
  assert(this_private_window.error == ProfileError::kNone && this_private_window.off_the_record);
  assert(route(ProfileKind::kPrivate, false, false, false).error == ProfileError::kWindowMismatch);
  assert(route(ProfileKind::kPrivate, false, false, true).error == ProfileError::kWindowMismatch);
  assert(route(ProfileKind::kPrivate, true, false, false).error == ProfileError::kWindowMismatch);
  assert(route(ProfileKind::kPrivate, true, true, true).error == ProfileError::kPrivateEnding);
  assert(route(ProfileKind::kDefault, true, true, false).error == ProfileError::kPrivateEnding);
  assert(IsDownloadControl("downloads.cancel") && IsDownloadControl("downloads.pause") &&
         IsDownloadControl("downloads.resume") && IsDownloadControl("downloads.keep"));
  assert(!IsDownloadControl("downloads.list") && !IsDownloadControl("downloads.settings") && !IsDownloadControl("downloads.remove"));
  assert(DownloadCommand("downloads.cancel") == "cancel");
  assert(DeliversRemoval(false, false, "/data/Default", "/data/Default"));
  assert(DeliversRemoval(false, true, "/data/Default", "/data/Default"));
  assert(DeliversRemoval(false, false, "/data/Isolated", "/data/Default"));
  assert(DeliversRemoval(true, true, "/data/Default", "/data/Default"));
  assert(!DeliversRemoval(true, false, "/data/Default", "/data/Default"));
  assert(!DeliversRemoval(true, true, "/data/Isolated", "/data/Default"));
  assert(!DeliversRemoval(true, true, "", ""));
  assert(DownloadCommand("downloads.pause") == "pause");
  assert(DownloadCommand("downloads.resume") == "resume");
  assert(DownloadCommand("downloads.keep") == "keep");
  assert(DownloadCommand("downloads.remove").empty() && DownloadCommand("history.query").empty());
  assert(std::string_view(kDownloadCommandService) == "ac_downloads_command");
}

void Clears() {
  const std::string id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  base::ListValue keep;
  keep.Append(base::Value(id));
  base::DictValue ok;
  ok.Set("keep", base::Value(std::move(keep)));
  ok.Set("before", base::Value(1700000000000.0));
  assert(ValidateRequest("downloads.clear", ok).empty());
  base::DictValue ints;
  ints.Set("keep", base::Value(base::ListValue()));
  ints.Set("before", base::Value(5));
  assert(ValidateRequest("downloads.clear", ints).empty());
  assert(!ValidateRequest("downloads.clear", Dict({})).empty());
  assert(!ValidateRequest("downloads.clear", Dict({{"before", base::Value(1.0)}})).empty());
  base::ListValue bad;
  bad.Append(base::Value("saved-1"));
  base::DictValue invalid;
  invalid.Set("keep", base::Value(std::move(bad)));
  invalid.Set("before", base::Value(1.0));
  assert(!ValidateRequest("downloads.clear", invalid).empty());
  base::ListValue many;
  for (size_t n = 0; n <= kMaxKeptDownloads; ++n) many.Append(base::Value(id));
  base::DictValue oversized;
  oversized.Set("keep", base::Value(std::move(many)));
  oversized.Set("before", base::Value(1.0));
  assert(!ValidateRequest("downloads.clear", oversized).empty());
  base::DictValue negative;
  negative.Set("keep", base::Value(base::ListValue()));
  negative.Set("before", base::Value(-1.0));
  assert(!ValidateRequest("downloads.clear", negative).empty());
  assert(KeptIds(ok) == std::vector<std::string>{id});
}

void FileGates() {
  const std::vector<std::string> targets = {"/d/a.zip", "/d/b c.pdf"};
  assert(IconPathAllowed("a.zip", targets));
  assert(IconPathAllowed("file.bin", targets));
  assert(IconPathAllowed("/d/a.zip", targets));
  assert(!IconPathAllowed("/Applications/Arc.app", targets));
  assert(!IconPathAllowed("dir/a.zip", targets));
  assert(!IconPathAllowed("", targets));
  assert(!IconPathAllowed(std::string("a\0b", 3), targets));
  assert(ListedPaths({"/d/a.zip", "/etc/passwd", "/d/b c.pdf", "relative"}, targets) ==
         (std::vector<bool>{true, false, true, false}));
  assert(ChooseOpenBackend(true) == OpenBackend::kDesktop);
  assert(ChooseOpenBackend(false) == OpenBackend::kUnavailable);
  assert(ChooseDragStart(true, false, true) == DragStart::kStart);
  assert(ChooseDragStart(true, false, false) == DragStart::kButtonReleased);
  assert(ChooseDragStart(true, true, true) == DragStart::kDragActive);
  assert(ChooseDragStart(false, false, true) == DragStart::kWindowClosed);
  for (const char* capability : kFileCapabilities) std::printf("capability %s\n", capability);
}

}

int main() {
  Ids();
  Paths();
  Requests();
  Snapshots();
  Routes();
  Clears();
  FileGates();
  std::puts("downloads scenarios passed");
  return 0;
}
