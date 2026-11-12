#include "ardia/core/ac_safe_storage.h"

#import <AppKit/AppKit.h>
#include <Security/Security.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <atomic>
#include <initializer_list>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/command_line.h"
#include "base/files/file_enumerator.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/process/process.h"
#include "base/strings/string_number_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/common/chrome_constants.h"
#include "chrome/common/chrome_switches.h"
#include "components/password_manager/core/browser/password_manager_constants.h"
#include "components/webdata/common/webdata_constants.h"
#include "crypto/apple/keychain_v2.h"
#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_launch_switches.h"

namespace ardiacore {

namespace {

bool g_fresh_user_data_dir = false;
std::atomic<bool> g_start_over_requested{false};

bool KeyMayBeCreated() {
  return g_fresh_user_data_dir || g_start_over_requested.exchange(false);
}

bool TestAnswersStartOver() {
  return BackgroundInstance() &&
         TestValue("safeStorageAnswer") == "start-over";
}

enum class Presence { kAbsent, kPresent, kUnknown };

Presence ProbeOne(const base::FilePath& path) {
  struct stat info;
  if (lstat(path.value().c_str(), &info) != 0) {
    return errno == ENOENT ? Presence::kAbsent : Presence::kUnknown;
  }
  if (stat(path.value().c_str(), &info) != 0) {
    return Presence::kUnknown;
  }
  return Presence::kPresent;
}

struct Marker {
  base::FilePath::StringViewType dir;
  base::FilePath::StringViewType name;
};

Presence Probe(const base::FilePath& root, const Marker& marker) {
  base::FilePath path = root;
  for (base::FilePath::StringViewType part : {marker.dir, marker.name}) {
    if (part.empty()) {
      continue;
    }
    path = path.Append(part);
    const Presence presence = ProbeOne(path);
    if (presence != Presence::kPresent) {
      return presence;
    }
  }
  return Presence::kPresent;
}

bool SurelyHoldsNoProfileData(const base::FilePath& profile) {
  const Marker markers[] = {
      {{}, chrome::kPreferencesFilename},
      {{}, chrome::kCookieFilename},
      {chrome::kNetworkDataDirname, chrome::kCookieFilename},
      {{}, password_manager::kLoginDataForProfileFileName},
      {{}, password_manager::kLoginDataForAccountFileName},
      {{}, kWebDataFilename},
  };
  for (const Marker& marker : markers) {
    if (Probe(profile, marker) != Presence::kAbsent) {
      return false;
    }
  }
  return true;
}

bool IsFreshUserDataDir(const base::FilePath& dir) {
  if (dir.empty()) {
    return false;
  }
  switch (ProbeOne(dir)) {
    case Presence::kAbsent:
      return true;
    case Presence::kUnknown:
      return false;
    case Presence::kPresent:
      break;
  }
  if (Probe(dir, {{}, chrome::kLocalStateFilename}) != Presence::kAbsent) {
    return false;
  }
  base::FileEnumerator entries(
      dir, false, base::FileEnumerator::NAMES_ONLY, FILE_PATH_LITERAL(""),
      base::FileEnumerator::FolderSearchPolicy::MATCH_ONLY,
      base::FileEnumerator::ErrorPolicy::STOP_ENUMERATION);
  for (base::FilePath entry = entries.Next(); !entry.empty();
       entry = entries.Next()) {
    struct stat info;
    if (stat(entry.value().c_str(), &info) != 0) {
      if (errno != ENOENT) {
        return false;
      }
      if (ProbeOne(entry) != Presence::kAbsent) {
        return false;
      }
      continue;
    }
    if (S_ISDIR(info.st_mode) && !SurelyHoldsNoProfileData(entry)) {
      return false;
    }
  }
  const base::File::Error error = entries.GetError();
  return error == base::File::FILE_OK ||
         error == base::File::FILE_ERROR_NOT_FOUND;
}

enum class KeyProblem { kMissing, kLocked, kEntitlement, kDamaged, kOther };

KeyProblem Classify(int status) {
  switch (status) {
    case errSecItemNotFound:
      return KeyProblem::kMissing;
    case errSecAuthFailed:
    case errSecUserCanceled:
    case errSecInteractionNotAllowed:
    case errSecInteractionRequired:
    case errSecNoAccessForItem:
      return KeyProblem::kLocked;
    case errSecMissingEntitlement:
      return KeyProblem::kEntitlement;
    case errSecDecode:
      return KeyProblem::kDamaged;
    default:
      return KeyProblem::kOther;
  }
}

void AskAboutKey(int status, base::OnceClosure retry) {
  const KeyProblem problem = Classify(status);
  const bool missing = problem == KeyProblem::kMissing;
  NSAlert* alert = [[NSAlert alloc] init];
  NSButton* quit = nil;
  NSButton* second = nil;
  if (missing) {
    alert.messageText = @"Ardia can't read its Safe Storage key.";
    alert.informativeText =
        @"Your saved passwords and cookies are locked with a key kept in your "
        @"login keychain, and Ardia couldn't read it. Quit and open Ardia "
        @"again later, or start over with a new key. If you start over, your "
        @"saved passwords and cookies can't be recovered.";
    quit = [alert addButtonWithTitle:@"Quit"];
    second = [alert addButtonWithTitle:@"Start Over with a New Key"];
    second.hasDestructiveAction = YES;
    if (TestAnswersStartOver()) {
      quit.keyEquivalent = @"";
      second.keyEquivalent = @"\e";
    }
  } else if (problem == KeyProblem::kLocked) {
    alert.messageText = @"Ardia can't open its Safe Storage key.";
    alert.informativeText =
        @"Your saved passwords and cookies are locked with a key kept in your "
        @"login keychain, and Ardia isn't allowed to open it. Unlock your "
        @"login keychain, or allow Ardia to use \u201CArdia Safe Storage\u201D "
        @"in Keychain Access, then choose Try Again.";
    quit = [alert addButtonWithTitle:@"Quit"];
    second = [alert addButtonWithTitle:@"Try Again"];
  } else if (problem == KeyProblem::kEntitlement) {
    alert.messageText = @"This copy of Ardia can't use your keychain.";
    alert.informativeText =
        @"Ardia keeps the key to your saved passwords and cookies in your "
        @"login keychain, and this copy of Ardia isn't allowed to open it. "
        @"Reinstall Ardia from ardia.dev, then open it again.";
    quit = [alert addButtonWithTitle:@"Quit"];
    second = [alert addButtonWithTitle:@"Try Again"];
  } else if (problem == KeyProblem::kOther) {
    alert.messageText = @"Ardia couldn't open its Safe Storage key.";
    alert.informativeText =
        @"Your saved passwords and cookies are locked with a key kept in your "
        @"login keychain, and Ardia couldn't open it just now. Try again, or "
        @"quit and open Ardia later.";
    quit = [alert addButtonWithTitle:@"Quit"];
    second = [alert addButtonWithTitle:@"Try Again"];
  } else {
    alert.messageText = @"Ardia's Safe Storage key is damaged.";
    alert.informativeText =
        @"Your saved passwords and cookies are locked with a key kept in your "
        @"login keychain, and that key can't be used. Restore your login "
        @"keychain from a backup, or delete \u201CArdia Safe Storage\u201D in "
        @"Keychain Access and choose Try Again. If you delete it, your saved "
        @"passwords and cookies can't be recovered.";
    quit = [alert addButtonWithTitle:@"Quit"];
    second = [alert addButtonWithTitle:@"Try Again"];
  }
  LOG(ERROR) << "[ardiacore] Safe Storage key unreadable (" << status
             << "): asking";
  const NSModalResponse response = [alert runModal];
  if (response != NSAlertSecondButtonReturn) {
    LOG(ERROR) << "[ardiacore] Safe Storage key unreadable: quitting";
    base::Process::TerminateCurrentProcessImmediately(EXIT_FAILURE);
  }
  LOG(ERROR) << "[ardiacore] Safe Storage key unreadable: "
             << (missing ? "starting over" : "trying again");
  if (missing) {
    g_start_over_requested = true;
  }
  std::move(retry).Run();
}

void SafeStorageUnreadable(int status, base::OnceClosure retry) {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&AskAboutKey, status, std::move(retry)));
}

class FileKeychain : public crypto::apple::KeychainV2 {
 public:
  FileKeychain(base::FilePath secret,
               base::FilePath log,
               int hidden_reads,
               OSStatus failure)
      : secret_(std::move(secret)),
        log_(std::move(log)),
        hidden_reads_(hidden_reads),
        failure_(failure) {}

  base::expected<std::vector<uint8_t>, OSStatus> FindGenericPassword(
      std::string_view service_name,
      std::string_view account_name) override {
    if (failure_ != noErr) {
      Note("find failed " + base::NumberToString(failure_));
      return base::unexpected(failure_);
    }
    if (hidden_reads_ > 0) {
      --hidden_reads_;
      Note("find hidden");
      return base::unexpected(errSecItemNotFound);
    }
    std::optional<std::vector<uint8_t>> bytes = base::ReadFileToBytes(secret_);
    if (!bytes) {
      Note("find missing");
      return base::unexpected(errSecItemNotFound);
    }
    Note(bytes->empty() ? "find empty" : "find found");
    return std::move(*bytes);
  }

  OSStatus AddGenericPasswordIfAbsent(
      std::string_view service_name,
      std::string_view account_name,
      base::span<const uint8_t> password) override {
    base::ScopedFD fd(
        open(secret_.value().c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600));
    if (!fd.is_valid()) {
      const bool exists = errno == EEXIST;
      Note(exists ? "add duplicate" : "add failed");
      return exists ? errSecDuplicateItem : errSecIO;
    }
    if (!base::WriteFileDescriptor(fd.get(), password)) {
      Note("add failed");
      return errSecIO;
    }
    Note("add created");
    return noErr;
  }

  OSStatus AddGenericPassword(std::string_view service_name,
                              std::string_view account_name,
                              base::span<const uint8_t> password) override {
    Note("add-or-update refused");
    return errSecUnimplemented;
  }

  OSStatus ItemAdd(CFDictionaryRef attributes, CFTypeRef* result) override {
    Note("item add refused");
    return errSecUnimplemented;
  }

  OSStatus ItemCopyMatching(CFDictionaryRef query, CFTypeRef* result) override {
    Note("item copy refused");
    return errSecUnimplemented;
  }

  OSStatus ItemDelete(CFDictionaryRef query) override {
    Note("item delete refused");
    return errSecUnimplemented;
  }

  OSStatus ItemUpdate(CFDictionaryRef query,
                      CFDictionaryRef keychain_data) override {
    Note("item update refused");
    return errSecUnimplemented;
  }

 private:
  void Note(std::string_view what) {
    const std::string line = std::string(what) + "\n";
    if (!base::AppendToFile(log_, line)) {
      base::WriteFile(log_, line);
    }
  }

  const base::FilePath secret_;
  const base::FilePath log_;
  int hidden_reads_;
  const OSStatus failure_;
};

base::FilePath& TestKeychainDir() {
  static base::NoDestructor<base::FilePath> dir;
  return *dir;
}

crypto::apple::KeychainV2* TestKeychain() {
  int hidden_reads = 0;
  if (const std::optional<std::string> hide =
          TestValue("keychainHiddenReads")) {
    base::StringToInt(*hide, &hidden_reads);
  }
  const std::optional<std::string> fail = TestValue("keychainFail");
  OSStatus failure = noErr;
  const std::pair<const char*, OSStatus> failures[] = {
      {"decode", errSecDecode},
      {"denied", errSecAuthFailed},
      {"interaction", errSecInteractionRequired},
      {"entitlement", errSecMissingEntitlement},
      {"io", errSecIO},
  };
  for (const auto& [name, status] : failures) {
    if (fail == name) {
      failure = status;
    }
  }
  static base::NoDestructor<FileKeychain> keychain(
      TestKeychainDir().Append("Test Safe Storage Key"),
      TestKeychainDir().Append("Test Safe Storage Log"), hidden_reads,
      failure);
  return keychain.get();
}

}

void GuardSafeStorageKey(const base::CommandLine& command_line) {
  const base::FilePath dir =
      command_line.GetSwitchValuePath(switches::kUserDataDir);
  g_fresh_user_data_dir = IsFreshUserDataDir(dir);
  g_ardia_safe_storage_key_may_be_created = &KeyMayBeCreated;
  g_ardia_safe_storage_unreadable = &SafeStorageUnreadable;
  if (TestValue("keychain") != "file") {
    return;
  }
  TestKeychainDir() = dir;
  g_ardia_test_keychain = &TestKeychain;
}

}
