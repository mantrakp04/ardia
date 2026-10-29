#include <sys/stat.h>
#include <unistd.h>

#include <cassert>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <initializer_list>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/linux/ac_linux_downloads.h"
#include "ardia/linux/ac_linux_file_drop.h"

using namespace ardia::linux_downloads;

namespace {

base::DictValue Dict(std::initializer_list<std::pair<const char*, base::Value>> entries) {
  base::DictValue dict;
  for (const auto& [key, value] : entries) dict.Set(key, value.Clone());
  return dict;
}

void Touch(const std::string& path, const std::string& text = "data") {
  std::ofstream(path) << text;
}

std::string Read(const std::string& path) {
  std::ifstream input(path);
  std::stringstream buffer;
  buffer << input.rdbuf();
  return buffer.str();
}

bool Exists(const std::string& path) {
  struct stat info;
  return lstat(path.c_str(), &info) == 0;
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

void Reveal() {
  assert(ChooseRevealBackend({.portal = true, .file_manager = true, .xdg_open = true}) == RevealBackend::kPortal);
  assert(ChooseRevealBackend({.portal = true}) == RevealBackend::kPortal);
  assert(ChooseRevealBackend({.file_manager = true}) == RevealBackend::kFileManager);
  assert(ChooseRevealBackend({.xdg_open = true, .folder_handler = true}) == RevealBackend::kOpenFolder);
  assert(ChooseRevealBackend({.xdg_open = true, .folder_handler = false}) == RevealBackend::kUnavailable);
  assert(ChooseRevealBackend({.folder_handler = true}) == RevealBackend::kUnavailable);
  assert(ChooseRevealBackend({}) == RevealBackend::kUnavailable);
  using Order = std::vector<RevealBackend>;
  assert((RevealOrder({.portal = true, .file_manager = true, .xdg_open = true, .folder_handler = true}) ==
          Order{RevealBackend::kPortal, RevealBackend::kFileManager, RevealBackend::kOpenFolder}));
  assert((RevealOrder({.portal = true, .xdg_open = true}) == Order{RevealBackend::kPortal}));
  assert((RevealOrder({.file_manager = true, .xdg_open = true, .folder_handler = true}) ==
          Order{RevealBackend::kFileManager, RevealBackend::kOpenFolder}));
  assert(RevealOrder({.folder_handler = true}).empty() && RevealOrder({}).empty());
  assert(OpenFolderLaunched(std::nullopt) && OpenFolderLaunched(0));
  assert(!OpenFolderLaunched(1) && !OpenFolderLaunched(3) && !OpenFolderLaunched(4) && !OpenFolderLaunched(-1));
  assert(RevealFailureMessage({RevealBackend::kPortal, RevealBackend::kFileManager, RevealBackend::kOpenFolder}) ==
         "The desktop portal, the file manager and the folder app couldn't show this file");
  assert(RevealFailureMessage({RevealBackend::kFileManager}) == "The file manager couldn't show this file");
  assert(RevealFailureMessage({RevealBackend::kPortal, RevealBackend::kOpenFolder}) ==
         "The desktop portal and the folder app couldn't show this file");
  assert(RevealFailureMessage({}) == "No desktop portal, file manager or folder application can show this file");
}

void RevealChain() {
  using B = RevealBackend;
  using A = RevealAnswer;
  RevealOutcome outcome;
  LinuxRevealChain none({});
  assert(!none.Begin(&outcome) && outcome.done && !outcome.ok && outcome.code == "ERR_REVEAL_UNAVAILABLE");

  LinuxRevealChain chain({B::kPortal, B::kFileManager, B::kOpenFolder});
  outcome = {};
  assert(chain.Begin(&outcome) == B::kPortal && !outcome.done);
  assert(chain.Answer(B::kPortal, A::kTimedOut, &outcome) == B::kFileManager && !outcome.done);
  assert(!chain.Answer(B::kPortal, A::kShown, &outcome) && !outcome.done);
  assert(chain.Answer(B::kFileManager, A::kUnavailable, &outcome) == B::kOpenFolder && !outcome.done);
  assert(!chain.Answer(B::kOpenFolder, A::kFailed, &outcome) && outcome.done && !outcome.ok);
  assert(outcome.code == "ERR_REVEAL_FAILED" && outcome.message == "The desktop portal and the folder app couldn't show this file");
  assert(!chain.Answer(B::kOpenFolder, A::kShown, &outcome));

  LinuxRevealChain cancelled({B::kPortal, B::kOpenFolder});
  outcome = {};
  cancelled.Begin(&outcome);
  assert(!cancelled.Answer(B::kPortal, A::kCancelled, &outcome) && outcome.done && outcome.ok);
  LinuxRevealChain shown({B::kFileManager});
  outcome = {};
  shown.Begin(&outcome);
  assert(!shown.Answer(B::kFileManager, A::kShown, &outcome) && outcome.done && outcome.ok);
  LinuxRevealChain skipped({B::kFileManager});
  outcome = {};
  skipped.Begin(&outcome);
  assert(!skipped.Answer(B::kFileManager, A::kUnavailable, &outcome) && outcome.done && outcome.code == "ERR_REVEAL_UNAVAILABLE");
}

void RevealTarget(const std::string& scratch) {
  const std::string file = scratch + "/reveal.bin";
  Touch(file, "r");
  int fd = OpenRevealTarget(file);
  assert(fd >= 0);
  close(fd);
  const std::string fifo = scratch + "/reveal.fifo";
  assert(mkfifo(fifo.c_str(), 0600) == 0);
  assert(OpenRevealTarget(fifo) < 0);
  const std::string link = scratch + "/reveal.link";
  assert(symlink(file.c_str(), link.c_str()) == 0);
  assert(OpenRevealTarget(link) < 0);
  assert(OpenRevealTarget(scratch) < 0);
  assert(OpenRevealTarget(scratch + "/missing") < 0);
  unlink(fifo.c_str());
  unlink(link.c_str());
  unlink(file.c_str());
}

void Trash(const std::string& scratch) {
  assert(TrashDirectory("/x/data", "/home/me") == "/x/data/Trash");
  assert(TrashDirectory("relative", "/home/me") == "/home/me/.local/share/Trash");
  assert(TrashDirectory("", "/home/me") == "/home/me/.local/share/Trash");
  assert(TrashDirectory(nullptr, nullptr).empty());
  assert(TrashDirectory(nullptr, "home").empty());

  const std::string downloads = scratch + "/Downloads";
  const std::string trash = scratch + "/data/Trash";
  mkdir(downloads.c_str(), 0700);
  const std::string file = downloads + "/report 1.pdf";
  Touch(file, "first");
  const std::time_t when = 1700000000;
  auto moved = MoveToTrash(file, trash, when);
  assert(moved.ok);
  assert(moved.trashed == trash + "/files/report 1.pdf");
  assert(!Exists(file));
  assert(Read(moved.trashed) == "first");
  const std::string info = Read(trash + "/info/report 1.pdf.trashinfo");
  assert(info == "[Trash Info]\nPath=" + FileUrl(file).substr(7) + "\nDeletionDate=2023-11-14T22:13:20\n");

  Touch(file, "second");
  Touch(trash + "/files/report 1.2.pdf", "orphan without info");
  auto again = MoveToTrash(file, trash, when);
  assert(again.ok);
  assert(again.trashed == trash + "/files/report 1.3.pdf");
  assert(Read(trash + "/files/report 1.2.pdf") == "orphan without info");
  assert(!Exists(trash + "/info/report 1.2.pdf.trashinfo"));
  assert(Exists(trash + "/info/report 1.3.pdf.trashinfo"));

  const std::string plain = downloads + "/README";
  Touch(plain);
  Touch(downloads + "/elsewhere");
  assert(MoveToTrash(plain, trash, when).ok);
  Touch(plain);
  assert(MoveToTrash(plain, trash, when).trashed == trash + "/files/README.2");

  assert(MoveToTrash(downloads + "/missing.zip", trash, when).code == "ERR_FILE_MISSING");
  assert(MoveToTrash(downloads, trash, when).code == "ERR_FILE_TYPE");
  const std::string link_path = downloads + "/link";
  assert(symlink((downloads + "/elsewhere").c_str(), link_path.c_str()) == 0);
  assert(MoveToTrash(link_path, trash, when).code == "ERR_FILE_TYPE");
  assert(Exists(downloads + "/elsewhere"));
  assert(MoveToTrash(downloads + "/elsewhere", "", when).code == "ERR_TRASH_UNAVAILABLE");
  assert(MoveToTrash(downloads + "/elsewhere", "relative/Trash", when).code == "ERR_TRASH_UNAVAILABLE");
  assert(MoveToTrash("relative", trash, when).code == "ERR_FILE_PATH");
  assert(MoveToTrash(downloads + "/../Downloads/elsewhere", trash, when).code == "ERR_FILE_PATH");
  const std::string blocked = scratch + "/blocked";
  Touch(blocked);
  assert(MoveToTrash(downloads + "/elsewhere", blocked + "/Trash", when).code == "ERR_TRASH_UNAVAILABLE");
  assert(Exists(downloads + "/elsewhere"));
}

void VolumeTrash(const std::string& scratch) {
  const std::time_t when = 1700000000;
  const uid_t uid = getuid();
  const std::string user = std::to_string(uid);

  const std::string shared = scratch + "/shared";
  mkdir(shared.c_str(), 0755);
  mkdir((shared + "/.Trash").c_str(), 0777);
  chmod((shared + "/.Trash").c_str(), 01777);
  mkdir((shared + "/media").c_str(), 0700);
  Touch(shared + "/media/clip.mp4", "clip");
  auto sticky = MoveToTopdirTrash(shared + "/media/clip.mp4", shared, uid, when);
  assert(sticky.ok);
  assert(sticky.trashed == shared + "/.Trash/" + user + "/files/clip.mp4");
  assert(Read(shared + "/.Trash/" + user + "/info/clip.mp4.trashinfo") ==
         "[Trash Info]\nPath=media/clip.mp4\nDeletionDate=2023-11-14T22:13:20\n");
  struct stat own;
  assert(lstat((shared + "/.Trash/" + user).c_str(), &own) == 0 && (own.st_mode & 0777) == 0700);

  const std::string loose = scratch + "/loose";
  mkdir(loose.c_str(), 0755);
  mkdir((loose + "/.Trash").c_str(), 0777);
  chmod((loose + "/.Trash").c_str(), 0777);
  Touch(loose + "/notes.txt", "notes");
  auto fallback = MoveToTopdirTrash(loose + "/notes.txt", loose, uid, when);
  assert(fallback.ok);
  assert(fallback.trashed == loose + "/.Trash-" + user + "/files/notes.txt");
  assert(!Exists(loose + "/.Trash/" + user));
  assert(Read(loose + "/.Trash-" + user + "/info/notes.txt.trashinfo").find("Path=notes.txt\n") != std::string::npos);

  const std::string linked = scratch + "/linked";
  const std::string elsewhere = scratch + "/elsewhere-trash";
  mkdir(linked.c_str(), 0755);
  mkdir(elsewhere.c_str(), 0777);
  chmod(elsewhere.c_str(), 01777);
  assert(symlink(elsewhere.c_str(), (linked + "/.Trash").c_str()) == 0);
  assert(symlink(elsewhere.c_str(), (linked + "/.Trash-" + user).c_str()) == 0);
  Touch(linked + "/a.bin", "a");
  auto refused = MoveToTopdirTrash(linked + "/a.bin", linked, uid, when);
  assert(!refused.ok && refused.code == "ERR_TRASH_UNAVAILABLE");
  assert(Exists(linked + "/a.bin"));
  assert(!Exists(elsewhere + "/" + user));
  assert(!Exists(elsewhere + "/files"));

  const std::string planted = scratch + "/planted";
  mkdir(planted.c_str(), 0755);
  mkdir((planted + "/.Trash-" + user).c_str(), 0700);
  assert(symlink(elsewhere.c_str(), (planted + "/.Trash-" + user + "/files").c_str()) == 0);
  Touch(planted + "/b.bin", "b");
  auto redirected = MoveToTopdirTrash(planted + "/b.bin", planted, uid, when);
  assert(!redirected.ok && redirected.code == "ERR_TRASH_UNAVAILABLE");
  assert(Exists(planted + "/b.bin"));

  const std::string alias = scratch + "/alias";
  assert(symlink(shared.c_str(), alias.c_str()) == 0);
  char real_shared[PATH_MAX];
  assert(realpath(shared.c_str(), real_shared));
  assert(ResolvedFile(alias + "/media/x.bin") == std::string(real_shared) + "/media/x.bin");
  assert(ResolvedFile("relative/x").empty());
  assert(ResolvedFile(scratch + "/missing-dir/x").empty());
  Touch(shared + "/media/aliased.mp4", "aliased");
  auto via_alias = MoveToTopdirTrash(ResolvedFile(alias + "/media/aliased.mp4"), real_shared, uid, when);
  assert(via_alias.ok);
  assert(Read(std::string(real_shared) + "/.Trash/" + user + "/info/aliased.mp4.trashinfo").find("Path=media/aliased.mp4\n") != std::string::npos);

  const std::string open_top = scratch + "/open-top";
  mkdir(open_top.c_str(), 0777);
  chmod(open_top.c_str(), 0777);
  const std::string own_trash = open_top + "/.Trash-" + user;
  Touch(open_top + "/c.bin", "c");
  auto raced = MoveToTopdirTrash(open_top + "/c.bin", open_top, uid, when, [&](TrashStage stage) {
    if (stage != TrashStage::kBeforeRecord) return;
    assert(rename(own_trash.c_str(), (open_top + "/stolen").c_str()) == 0);
    mkdir(own_trash.c_str(), 0700);
    assert(symlink(elsewhere.c_str(), (own_trash + "/files").c_str()) == 0);
    mkdir((own_trash + "/info").c_str(), 0700);
  });
  assert(raced.ok);
  assert(Read(open_top + "/stolen/files/c.bin") == "c");
  assert(Exists(open_top + "/stolen/info/c.bin.trashinfo"));
  assert(!Exists(own_trash + "/info/c.bin.trashinfo") && !Exists(elsewhere + "/c.bin"));
  assert(raced.trashed == open_top + "/stolen/files/c.bin");
  assert(!Exists(open_top + "/c.bin"));
  assert(unlink((own_trash + "/files").c_str()) == 0 && rmdir((own_trash + "/info").c_str()) == 0 &&
         rmdir(own_trash.c_str()) == 0);

  Touch(open_top + "/d.bin", "d");
  auto changed = MoveToTopdirTrash(open_top + "/d.bin", open_top, uid, when, [&](TrashStage stage) {
    if (stage != TrashStage::kBeforeRecord) return;
    assert(rename((open_top + "/d.bin").c_str(), (open_top + "/d.kept").c_str()) == 0);
    Touch(open_top + "/d.bin", "planted");
  });
  assert(!changed.ok && changed.code == "ERR_FILE_CHANGED");
  assert(Read(open_top + "/d.bin") == "planted" && Read(open_top + "/d.kept") == "d");
  assert(!Exists(own_trash + "/files/d.bin") && !Exists(own_trash + "/info/d.bin.trashinfo"));

  Touch(open_top + "/f.bin", "f");
  auto late = MoveToTopdirTrash(open_top + "/f.bin", open_top, uid, when, [&](TrashStage stage) {
    if (stage != TrashStage::kBeforeRemove) return;
    assert(rename((open_top + "/f.bin").c_str(), (open_top + "/f.kept").c_str()) == 0);
    Touch(open_top + "/f.bin", "planted");
  });
  assert(!late.ok && late.code == "ERR_FILE_CHANGED");
  assert(Read(open_top + "/f.bin") == "planted" && Read(open_top + "/f.kept") == "f");
  assert(!Exists(own_trash + "/files/f.bin") && !Exists(own_trash + "/info/f.bin.trashinfo"));

  const std::string home_trash = scratch + "/home-trash";
  Touch(scratch + "/e.bin", "e");
  auto home = MoveToTrash(scratch + "/e.bin", home_trash, when, [&](TrashStage stage) {
    if (stage != TrashStage::kBeforeRecord) return;
    assert(rename(home_trash.c_str(), (scratch + "/home-trash-moved").c_str()) == 0);
    assert(symlink(elsewhere.c_str(), home_trash.c_str()) == 0);
  });
  assert(home.ok && home.trashed == scratch + "/home-trash-moved/files/e.bin");
  assert(Read(scratch + "/home-trash-moved/files/e.bin") == "e" && !Exists(elsewhere + "/files"));

  Touch(scratch + "/root-file", "r");
  assert(MoveToTopdirTrash(scratch + "/root-file", scratch + "/shared", uid, when).code == "ERR_FILE_PATH");
  assert(MountTop(shared + "/media") == MountTop(scratch));
  assert(MountTop("/").empty() || MountTop("/") == "/");

  const std::string other = "/dev/shm";
  struct stat here, there;
  if (stat(other.c_str(), &there) == 0 && stat(scratch.c_str(), &here) == 0 && here.st_dev != there.st_dev &&
      access(other.c_str(), W_OK) == 0) {
    char name[] = "/dev/shm/ardia-volume-XXXXXX";
    assert(mkdtemp(name));
    const std::string volume = name;
    const std::string file = volume + "/far.txt";
    Touch(file, "far");
    const std::string top = MountTop(file);
    const std::string own = (top == "/" ? "" : top) + "/.Trash-" + user;
    const bool existed = Exists(own);
    auto far = MoveToTrash(file, scratch + "/data/Trash", when);
    assert(far.ok);
    assert(far.trashed.rfind(top == "/" ? "/.Trash" : top + "/.Trash", 0) == 0);
    assert(Read(far.trashed) == "far");
    std::remove(far.trashed.c_str());
    const std::string used = far.trashed.substr(0, far.trashed.rfind("/files/"));
    std::remove((used + "/info/far.txt.trashinfo").c_str());
    if (!existed && used == own) {
      rmdir((own + "/files").c_str());
      rmdir((own + "/info").c_str());
      rmdir(own.c_str());
    }
    rmdir(volume.c_str());
    std::puts("volume trash crossed a mount");
  }
}

void Folders(const std::string& scratch) {
  const std::string folder = scratch + "/picked folder";
  mkdir(folder.c_str(), 0700);
  assert(CheckDownloadFolder(folder).ok);
  assert(CheckDownloadFolder(folder).code.empty());
  assert(CheckDownloadFolder(folder + "/").code == "ERR_FILE_PATH");
  assert(CheckDownloadFolder("relative/folder").code == "ERR_FILE_PATH");
  assert(CheckDownloadFolder(folder + "/../picked folder").code == "ERR_FILE_PATH");
  assert(CheckDownloadFolder(std::string("/tmp/a\0b", 8)).code == "ERR_FILE_PATH");
  assert(CheckDownloadFolder(folder + "/missing").code == "ERR_FOLDER_MISSING");
  Touch(folder + "/file.txt");
  assert(CheckDownloadFolder(folder + "/file.txt").code == "ERR_FOLDER_TYPE");
  const std::string linked = scratch + "/linked folder";
  assert(symlink(folder.c_str(), linked.c_str()) == 0);
  assert(CheckDownloadFolder(linked).ok);
  const std::string locked = scratch + "/locked";
  mkdir(locked.c_str(), 0500);
  if (geteuid() != 0) assert(CheckDownloadFolder(locked).code == "ERR_FOLDER_NOT_WRITABLE");
  chmod(locked.c_str(), 0700);
  assert(!CheckDownloadFolder(folder + "/missing").message.empty());
}

void Ledger() {
  LinuxDropLedger ledger;
  assert(!ledger.Take({}, 0));
  assert(ledger.Record({"/home/me/a.txt", "/home/me/b c.png"}, 1000));
  assert(ledger.pending());
  auto taken = ledger.Take({"b c.png", "a.txt"}, 2000);
  assert(taken && taken->size() == 2 && (*taken)[0] == "/home/me/a.txt");
  assert(!ledger.pending());
  assert(!ledger.Take({"b c.png", "a.txt"}, 2000));

  assert(ledger.Record({"/home/me/a.txt"}, 1000));
  assert(!ledger.Take({"other.txt"}, 1001));
  assert(!ledger.Take({"a.txt"}, 1002));

  assert(ledger.Record({"/home/me/a.txt"}, 1000));
  assert(!ledger.Take({"a.txt", "a.txt"}, 1001));

  assert(ledger.Record({"/home/me/a.txt"}, 1000));
  assert(!ledger.Take({"a.txt"}, 1000 + LinuxDropLedger::kLifetimeMs + 1));

  assert(ledger.Record({"/home/me/a.txt"}, 5000));
  assert(!ledger.Take({"a.txt"}, 4000));

  assert(ledger.Record({"/home/me/old.txt"}, 1000));
  assert(!ledger.Record({"relative.txt"}, 1000));
  assert(!ledger.pending());
  assert(!ledger.Record({"/"}, 1000));
  assert(!ledger.Record({}, 1000));
  std::vector<std::string> many(LinuxDropLedger::kMaxFiles + 1, "/home/me/x");
  assert(!ledger.Record(many, 1000));
  many.pop_back();
  assert(ledger.Record(many, 1000));
  assert(ledger.Take(std::vector<std::string>(LinuxDropLedger::kMaxFiles, "x"), 1000));

  assert(ledger.Record({"/home/me/first.txt"}, 1000));
  assert(ledger.Record({"/home/me/second.txt"}, 1100));
  assert(!ledger.Take({"first.txt"}, 1200));
  ledger.Clear();
  assert(!ledger.pending());
}

}

int main(int argc, char** argv) {
  assert(argc == 2);
  setenv("TZ", "UTC", 1);
  tzset();
  Ids();
  Paths();
  Requests();
  Reveal();
  RevealChain();
  RevealTarget(argv[1]);
  Snapshots();
  Routes();
  Clears();
  FileGates();
  Trash(argv[1]);
  VolumeTrash(argv[1]);
  Folders(argv[1]);
  Ledger();
  std::puts("downloads scenarios passed");
  return 0;
}
