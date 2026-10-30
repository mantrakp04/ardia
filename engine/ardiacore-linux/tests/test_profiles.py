from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'

FIXTURE = r'''
#include "ardia/linux/ac_linux_profiles.h"
#include <cassert>
#include <cstdio>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

using namespace ardiacore::linux_profiles;

struct FakeProfile {
  std::string directory;
  bool otr = false;
  bool dying = false;
  FakeProfile* child = nullptr;
};

struct FakeBackend : ProfileRegistry<FakeProfile>::Backend {
  std::map<std::string, std::unique_ptr<FakeProfile>> disk;
  std::vector<std::unique_ptr<FakeProfile>> otrs;
  std::vector<std::pair<std::string, std::function<void(FakeProfile*)>>> loads;
  bool synchronous = false;
  bool fail_loads = false;
  bool refuse_otr = false;
  bool otr_returns_original = false;
  FakeProfile* load_result_override = nullptr;
  int load_calls = 0;
  void Load(const std::string& directory, std::function<void(FakeProfile*)> done) override {
    ++load_calls;
    if (synchronous) return done(Make(directory));
    loads.emplace_back(directory, std::move(done));
  }
  FakeProfile* Make(const std::string& directory) {
    if (fail_loads) return nullptr;
    if (load_result_override) return load_result_override;
    auto& slot = disk[directory];
    if (!slot) slot = std::make_unique<FakeProfile>(FakeProfile{directory});
    return slot.get();
  }
  void Finish(size_t index = 0) {
    auto entry = std::move(loads[index]);
    loads.erase(loads.begin() + static_cast<long>(index));
    entry.second(Make(entry.first));
  }
  int creates = 0;
  FakeProfile* ExistingOffTheRecord(FakeProfile* original) override { return original->child; }
  FakeProfile* CreateOffTheRecord(FakeProfile* original) override {
    ++creates;
    if (refuse_otr) return nullptr;
    if (otr_returns_original) return original;
    if (!original->child) {
      otrs.push_back(std::make_unique<FakeProfile>(FakeProfile{original->directory + " OTR", true}));
      original->child = otrs.back().get();
    }
    return original->child;
  }
  bool Usable(FakeProfile* profile) const override { return profile && !profile->dying; }
  bool OffTheRecordProfile(FakeProfile* profile) const override { return profile && profile->otr; }
  std::vector<std::function<void()>> later;
  void Later(std::function<void()> task) override { later.push_back(std::move(task)); }
  std::set<FakeProfile*> watched;
  FakeProfile* refuse_watch = nullptr;
  bool Watch(FakeProfile* profile) override {
    if (!profile || profile->dying || profile == refuse_watch) return false;
    watched.insert(profile);
    return true;
  }
  void Destroy(ProfileRegistry<FakeProfile>& registry, FakeProfile* profile) {
    profile->dying = true;
    if (watched.erase(profile)) registry.Forget(profile);
  }
  void RunLater() {
    auto tasks = std::move(later);
    later.clear();
    for (auto& task : tasks) task();
  }
};

struct Result {
  FakeProfile* profile = nullptr;
  ProfileError error = ProfileError::kInvalid;
  int calls = 0;
};

ProfileRegistry<FakeProfile>::Done Into(Result& result) {
  return [&result](FakeProfile* profile, ProfileError error) {
    result.profile = profile;
    result.error = error;
    ++result.calls;
  };
}

void Parsing() {
  auto d = ParseProfileName("");
  assert(d && d->kind == ProfileKind::kDefault && d->id.empty());
  assert(ParseProfileName("default")->kind == ProfileKind::kDefault);
  auto iso = ParseProfileName("p-lx3k9-2");
  assert(iso && iso->kind == ProfileKind::kIsolated && iso->id == "p-lx3k9-2" && iso->original == "p-lx3k9-2");
  assert(ProfileDirectoryName(iso->id) == "Profile p-lx3k9-2");
  auto priv = ParseProfileName("incognito:w-abc-3@p-lx3k9-2");
  assert(priv && priv->kind == ProfileKind::kPrivate && priv->original == "p-lx3k9-2" && priv->window == "w-abc-3");
  auto priv_default = ParseProfileName("incognito:w-abc-4@");
  assert(priv_default && priv_default->original.empty() && priv_default->id == "incognito:w-abc-4@");
  assert(ParseProfileName("incognito:w-abc-4@default")->id == "incognito:w-abc-4@");
  for (const char* bad : {"Default", "DEFAULT", "Profile 1", "1", "../Default", "p/x", "p x", "incognito:", "incognito:w",
                          "incognito:@p-1", "incognito:w@incognito:x@", "incognito:w@../x", "incognito:w@Default",
                          "System Profile", "Guest Profile", "-p", "p\n"}) {
    assert(!ParseProfileName(bad));
  }
  assert(!ParseProfileName(std::string(129, 'p')));
  assert(ParseProfileName(std::string(128, 'p')));
  assert(ProfileOpensWindow(*ParseProfileName(""), false, false));
  assert(ProfileOpensWindow(*ParseProfileName("p-1"), false, false));
  assert(!ProfileOpensWindow(*ParseProfileName("p-1"), true, false));
  assert(!ProfileOpensWindow(*ParseProfileName("incognito:w@"), false, false));
  assert(ProfileOpensWindow(*ParseProfileName("incognito:w@"), true, false));
  assert(ProfileOpensWindow(*ParseProfileName(""), false, true));
  assert(!ProfileOpensWindow(*ParseProfileName("p-1"), false, true));
  assert(!ProfileOpensWindow(*ParseProfileName("incognito:w@"), true, true));
  assert(ProfileErrorCode(ProfileError::kWindowMismatch) == "ERR_PROFILE_WINDOW");
  assert(ProfileErrorCode(ProfileError::kPrivateService) == "ERR_PROFILE_PRIVATE");
  std::puts("parsing=ok");
}

void LookupAndNoFallback() {
  FakeBackend backend;
  FakeProfile app{"Default"};
  ProfileRegistry<FakeProfile> registry(backend);
  Result before;
  registry.Resolve("", Into(before));
  assert(before.calls == 1 && !before.profile && before.error == ProfileError::kUnavailable);
  FakeProfile otr_app{"Default OTR", true};
  assert(!registry.SetDefault(&otr_app));
  assert(registry.SetDefault(&app));
  assert(!registry.SetDefault(&otr_app));
  FakeProfile other{"Other"};
  assert(!registry.SetDefault(&other));
  assert(registry.Lookup("") == &app && registry.Lookup("default") == &app);
  assert(registry.NameOf(&app) == std::optional<std::string>(""));
  assert(!registry.Lookup("p-work"));
  assert(!registry.Lookup("incognito:w-1@"));
  assert(!registry.Lookup("Profile 1"));
  Result invalid;
  registry.Resolve("../Default", Into(invalid));
  assert(invalid.calls == 1 && !invalid.profile && invalid.error == ProfileError::kInvalid);
  assert(backend.load_calls == 0);

  Result first, second;
  registry.Resolve("p-work", Into(first));
  registry.Resolve("p-work", Into(second));
  assert(backend.load_calls == 1 && backend.loads.size() == 1 && backend.loads[0].first == "Profile p-work");
  assert(first.calls == 0 && second.calls == 0);
  backend.Finish();
  assert(first.calls == 1 && second.calls == 1 && first.profile == second.profile && first.profile != &app);
  assert(first.error == ProfileError::kNone && first.profile->directory == "Profile p-work");
  assert(registry.Lookup("p-work") == first.profile);
  assert(registry.NameOf(first.profile) == std::optional<std::string>("p-work"));
  assert(registry.Hosts("p-work", first.profile));
  assert(!registry.Hosts("", first.profile));
  assert(!registry.Hosts("p-work", &app));

  backend.load_result_override = &app;
  Result aliased;
  registry.Resolve("p-alias", Into(aliased));
  backend.Finish();
  assert(aliased.calls == 1 && !aliased.profile && aliased.error == ProfileError::kUnavailable);
  assert(!registry.Lookup("p-alias"));
  backend.load_result_override = first.profile;
  Result twice;
  registry.Resolve("p-twice", Into(twice));
  backend.Finish();
  assert(!twice.profile && twice.error == ProfileError::kUnavailable);
  FakeProfile otr_loaded{"Profile p-otr", true};
  backend.load_result_override = &otr_loaded;
  Result otr_regular;
  registry.Resolve("p-otr", Into(otr_regular));
  backend.Finish();
  assert(!otr_regular.profile && otr_regular.error == ProfileError::kUnavailable);
  backend.load_result_override = nullptr;
  backend.fail_loads = true;
  Result failed;
  registry.Resolve("p-broken", Into(failed));
  backend.Finish();
  assert(failed.calls == 1 && !failed.profile && failed.error == ProfileError::kUnavailable);
  backend.fail_loads = false;
  std::puts("lookup=ok no_fallback=ok");
}

void PrivateLifetime() {
  FakeBackend backend;
  backend.synchronous = true;
  FakeProfile app{"Default"};
  ProfileRegistry<FakeProfile> registry(backend);
  registry.SetDefault(&app);
  Result a, b, c;
  registry.Resolve("incognito:w-a@", Into(a));
  registry.Resolve("incognito:w-b@", Into(b));
  assert(a.profile && a.profile->otr && a.profile != &app && a.profile == b.profile);
  assert(registry.PrivateNames(a.profile) == 2);
  assert(!registry.NameOf(a.profile));
  registry.Resolve("incognito:w-c@p-work", Into(c));
  assert(c.profile && c.profile->otr && c.profile != a.profile && c.profile->directory == "Profile p-work OTR");
  assert(registry.Lookup("incognito:w-a@default") == a.profile);

  assert(registry.Release("incognito:w-a@"));
  assert(!registry.Lookup("incognito:w-a@"));
  assert(registry.Lookup("incognito:w-b@") == b.profile);
  Result again;
  registry.Resolve("incognito:w-a@", Into(again));
  assert(again.calls == 1 && !again.profile && again.error == ProfileError::kReleased);
  assert(!registry.Release("p-work") && !registry.Release(""));
  assert(registry.Lookup("p-work"));

  FakeProfile* disposed = b.profile;
  disposed->dying = true;
  assert(!registry.Lookup("incognito:w-b@"));
  registry.Forget(disposed);
  app.child = nullptr;
  assert(registry.PrivateNames(disposed) == 0);
  Result fresh;
  registry.Resolve("incognito:w-d@", Into(fresh));
  assert(fresh.profile && fresh.profile != disposed && !fresh.profile->dying);

  registry.Release("incognito:w-d@");
  app.child = nullptr;
  backend.refuse_otr = true;
  Result refused;
  registry.Resolve("incognito:w-e@", Into(refused));
  assert(!refused.profile && refused.error == ProfileError::kUnavailable);
  backend.refuse_otr = false;
  backend.otr_returns_original = true;
  Result regular_as_private;
  registry.Resolve("incognito:w-f@p-other", Into(regular_as_private));
  assert(!regular_as_private.profile && regular_as_private.error == ProfileError::kUnavailable);
  assert(!registry.Lookup("incognito:w-f@p-other"));
  backend.otr_returns_original = false;
  std::puts("private_lifetime=ok");
}

void ReleaseAndDeleteDuringResolution() {
  FakeBackend backend;
  FakeProfile app{"Default"};
  ProfileRegistry<FakeProfile> registry(backend);
  registry.SetDefault(&app);
  Result pending, joined;
  registry.Resolve("incognito:w-x@p-slow", Into(pending));
  registry.Resolve("incognito:w-x@p-slow", Into(joined));
  assert(backend.loads.size() == 1 && pending.calls == 0);
  registry.Release("incognito:w-x@p-slow");
  assert(pending.calls == 1 && joined.calls == 1 && pending.error == ProfileError::kReleased);
  backend.Finish();
  assert(pending.calls == 1 && joined.calls == 1);
  assert(!registry.Lookup("incognito:w-x@p-slow"));
  assert(registry.Lookup("p-slow"));

  Result deleted_during;
  registry.Resolve("p-gone", Into(deleted_during));
  assert(registry.MarkDeleted("p-gone"));
  backend.Finish();
  assert(deleted_during.calls == 1 && !deleted_during.profile && deleted_during.error == ProfileError::kDeleted);
  Result after;
  registry.Resolve("p-gone", Into(after));
  assert(after.calls == 1 && after.error == ProfileError::kDeleted);
  Result private_of_deleted;
  registry.Resolve("incognito:w-y@p-gone", Into(private_of_deleted));
  assert(private_of_deleted.calls == 1 && private_of_deleted.error == ProfileError::kDeleted);
  assert(!registry.MarkDeleted("") && !registry.MarkDeleted("incognito:w@"));
  std::puts("release_during_resolution=ok delete_during_load=ok");
}

void ReentrancyAndDestruction() {
  FakeBackend backend;
  FakeProfile app{"Default"};
  auto registry = std::make_unique<ProfileRegistry<FakeProfile>>(backend);
  registry->SetDefault(&app);
  Result nested;
  int outer = 0;
  registry->Resolve("p-re", [&](FakeProfile* profile, ProfileError) {
    ++outer;
    assert(profile);
    registry->Resolve("p-re", Into(nested));
  });
  backend.Finish();
  assert(outer == 1 && nested.calls == 1 && nested.profile);

  int after_destroy = 0;
  registry->Resolve("p-late", [&](FakeProfile*, ProfileError) {
    ++after_destroy;
    registry.reset();
  });
  registry->Resolve("p-late", [&](FakeProfile*, ProfileError) { ++after_destroy; });
  backend.Finish();
  assert(after_destroy == 1 && !registry);

  auto dropped = std::make_unique<ProfileRegistry<FakeProfile>>(backend);
  dropped->SetDefault(&app);
  int late_calls = 0;
  dropped->Resolve("p-orphan", [&](FakeProfile*, ProfileError) { ++late_calls; });
  dropped.reset();
  backend.Finish();
  assert(late_calls == 0);
  std::puts("reentrancy=ok destruction=ok");
}

void StartupProfilePinning() {
  StartupProfiles chrome_after_isolated_focus{"Profile p-work", {"Default", "Profile p-work"}, true};
  const auto pinned = PinnedStartupProfiles(chrome_after_isolated_focus, "Default");
  assert(pinned.last_used == "Default");
  assert(pinned.last_active == std::vector<std::string>{"Default"});
  assert(!pinned.picker_on_startup);
  const auto only_isolated = PinnedStartupProfiles({"Profile p-work", {"Profile p-work"}, false}, "Default");
  assert(only_isolated.last_used == "Default" && only_isolated.last_active == std::vector<std::string>{"Default"});
  const auto closed_all = PinnedStartupProfiles({"Default", {}, true}, "Default");
  assert(closed_all.last_active.empty() && !closed_all.picker_on_startup);
  assert(PinnedStartupProfiles(pinned, "Default") == pinned);
  const auto custom = PinnedStartupProfiles({"Profile p-x", {"Profile p-x"}, true}, "Work Dir");
  assert(custom.last_used == "Work Dir" && custom.last_active == std::vector<std::string>{"Work Dir"});
  std::puts("startup_pinned=ok");
}

void PrivateOrdinals() {
  assert(NextPrivateOrdinal({}) == 1);
  assert(NextPrivateOrdinal({1}) == 2);
  assert(NextPrivateOrdinal({1, 2, 3}) == 4);
  assert(NextPrivateOrdinal({3, 1}) == 2);
  assert(NextPrivateOrdinal({2, 3}) == 1);
  std::puts("private_ordinals=ok");
}

void PrivateWindowAccess() {
  const WindowAccess regular{"main", "", 1, 0, 0};
  const WindowAccess isolated{"w-work", "p-work", 2, 1, 4};
  const WindowAccess first{"w-p1", "incognito:w-p1@", 3, 1, 4};
  const WindowAccess second{"w-p2", "incognito:w-p2@p-work", 5, 3, 7};
  for (const WindowRequester requester : {WindowRequester{1, 4}, WindowRequester{2, 1}, WindowRequester{3, 7}, WindowRequester{9, 1}}) {
    assert(WindowReachableBy(regular, requester));
    assert(WindowReachableBy(isolated, requester));
  }
  assert(WindowReachableBy(first, {3, 1}));
  assert(WindowReachableBy(first, {3, 99}));
  assert(WindowReachableBy(first, {1, 4}));
  assert(!WindowReachableBy(first, {1, 5}));
  assert(!WindowReachableBy(first, {5, 7}));
  assert(!WindowReachableBy(first, {9, 4}));
  assert(WindowReachableBy(second, {3, 7}));
  assert(!WindowReachableBy(second, {1, 4}));
  const WindowAccess orphan{"w-p3", "incognito:w-p3@", 6, 0, 0};
  assert(WindowReachableBy(orphan, {6, 1}));
  assert(!WindowReachableBy(orphan, {0, 0}));
  assert(!WindowReachableBy(orphan, {1, 4}));
  const WindowAccess malformed{"w-x", "../x", 8, 1, 4};
  assert(!WindowReachableBy(malformed, {1, 5}));
  for (const WindowRequester requester : {WindowRequester{1, 4}, WindowRequester{1, 5}, WindowRequester{5, 7}, WindowRequester{9, 4}}) {
    assert(WindowFocusableBy(first, requester));
    assert(WindowFocusableBy(regular, requester));
  }
  assert(!WindowFocusableBy(first, {0, 0}));
  assert(!WindowFocusableBy(malformed, {1, 5}));
  assert(WindowListedAsPrivate(first, {1, 4}) && WindowListedAsPrivate(second, {1, 4}));
  assert(!WindowListedAsPrivate(first, {3, 1}));
  assert(!WindowListedAsPrivate(regular, {1, 4}) && !WindowListedAsPrivate(isolated, {3, 7}));
  assert(!WindowListedAsPrivate(malformed, {1, 4}) && !WindowListedAsPrivate(first, {0, 0}));
  std::puts("private_window_access=ok");
}

int main() {
  PrivateOrdinals();
  PrivateWindowAccess();
  StartupProfilePinning();
  Parsing();
  LookupAndNoFallback();
  PrivateLifetime();
  ReleaseAndDeleteDuringResolution();
  ReentrancyAndDestruction();
  return 0;
}
'''


class ProfileRegistryTests(unittest.TestCase):
    def test_registry_lookup_private_lifetime_and_no_fallback(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'main.cc').write_text(FIXTURE)
            binary = root / 'profiles'
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(SOURCE),
                                     str(SOURCE / 'ardia/linux/ac_linux_profiles.cc'), str(root / 'main.cc'), '-o', str(binary)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            run = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            for marker in ('private_ordinals=ok', 'private_window_access=ok', 'startup_pinned=ok', 'parsing=ok', 'no_fallback=ok', 'private_lifetime=ok', 'release_during_resolution=ok',
                           'delete_during_load=ok', 'reentrancy=ok', 'destruction=ok'):
                self.assertIn(marker, run.stdout)


if __name__ == '__main__':
    unittest.main()
