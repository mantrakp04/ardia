// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_engine.h"

#include <string.h>

#include <optional>
#include <utility>

#include "base/files/file_path.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/strcat.h"
#include "base/strings/string_util.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/sessions/content/session_tab_helper.h"
#include "content/public/browser/browser_thread.h"

namespace ardia {

namespace {

ac_engine_event_t g_sink = nullptr;
void* g_sink_context = nullptr;

std::string ToJSON(const base::DictValue& dict) {
  return base::WriteJson(dict).value_or("{}");
}

}

Reply::Reply(ac_engine_reply_t reply, void* context)
    : reply_(reply), context_(context) {}

Reply::Reply(Reply&& other)
    : reply_(std::exchange(other.reply_, nullptr)),
      context_(std::exchange(other.context_, nullptr)) {}

Reply& Reply::operator=(Reply&& other) {
  if (this != &other) {
    if (reply_) {
      Error("no reply");
    }
    reply_ = std::exchange(other.reply_, nullptr);
    context_ = std::exchange(other.context_, nullptr);
  }
  return *this;
}

Reply::~Reply() {
  if (reply_) {
    Error("no reply");
  }
}

void Reply::Send(base::DictValue result) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!reply_) {
    return;
  }
  ac_engine_reply_t reply = std::exchange(reply_, nullptr);
  void* context = std::exchange(context_, nullptr);
  reply(context, ToJSON(result).c_str());
}

void Reply::SendSecretJSON(std::string& json) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (reply_) {
    ac_engine_reply_t reply = std::exchange(reply_, nullptr);
    void* context = std::exchange(context_, nullptr);
    reply(context, json.c_str());
  }
  Cleanse(json);
}

void Reply::Ok() {
  Send(base::DictValue().Set("ok", true));
}

void Reply::Error(std::string_view message) {
  Send(base::DictValue().Set("error", message));
}

ArgsCall::ArgsCall(const char* args_json,
                   ac_engine_reply_t reply,
                   void* context,
                   size_t max_bytes,
                   OffTheRecord off_the_record)
    : reply_(reply, context) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  const bool sensitive = max_bytes != kNoArgsLimit;
  if (sensitive && !(args_json && *args_json)) {
    reply_.Error("arguments are not a JSON object");
    return;
  }
  if (args_json && *args_json) {
    if (sensitive &&
        strnlen(args_json, max_bytes + 1) > max_bytes) {
      reply_.Error("arguments too large");
      return;
    }
    std::optional<base::Value> parsed = base::JSONReader::Read(
        args_json, base::JSON_PARSE_CHROMIUM_EXTENSIONS);
    if (!parsed || !parsed->is_dict()) {
      if (parsed) {
        Cleanse(*parsed);
      }
      reply_.Error("arguments are not a JSON object");
      return;
    }
    args_ = std::move(*parsed).TakeDict();
  }
  off_the_record_ = args_.FindBool("offTheRecord").value_or(false);
  if (off_the_record_ && off_the_record != OffTheRecord::kAllow) {
    reply_.Error("no engine data for a private profile");
    return;
  }
  parsed_ = true;
}

ArgsCall::~ArgsCall() {
  for (auto [key, value] : args_) {
    Cleanse(value);
  }
}

std::string ArgsCall::String(std::string_view key) const {
  const std::string* value = args_.FindString(key);
  return value ? *value : std::string();
}

bool ArgsCall::Bool(std::string_view key, bool fallback) const {
  return args_.FindBool(key).value_or(fallback);
}

double ArgsCall::Double(std::string_view key, double fallback) const {
  return args_.FindDouble(key).value_or(fallback);
}

std::optional<Secret> ArgsCall::SecretAt(std::string_view key) const {
  const std::string* hex = args_.FindString(base::StrCat({key, "Hex"}));
  if (!hex) {
    return Secret(args_.FindString(key));
  }
  if (hex->size() % 2) {
    return std::nullopt;
  }
  std::string bytes(hex->size() / 2, '\0');
  for (size_t i = 0; i < bytes.size(); ++i) {
    const char high = (*hex)[2 * i], low = (*hex)[2 * i + 1];
    if (!base::IsHexDigit(high) || !base::IsHexDigit(low)) {
      Cleanse(bytes);
      return std::nullopt;
    }
    bytes[i] = static_cast<char>(base::HexDigitToInt(high) * 16 +
                                 base::HexDigitToInt(low));
  }
  return Secret(std::move(bytes));
}

Call::Call(const char* profile_dir,
           const char* args_json,
           ac_engine_reply_t reply,
           void* context,
           OffTheRecord off_the_record)
    : Call(profile_dir,
           args_json,
           reply,
           context,
           kNoArgsLimit,
           off_the_record) {}

Call::Call(const char* profile_dir,
           const char* args_json,
           ac_engine_reply_t reply,
           void* context,
           Sensitive sensitive)
    : Call(profile_dir,
           args_json,
           reply,
           context,
           sensitive.max_bytes,
           OffTheRecord::kRefuse) {}

Call::Call(const char* profile_dir,
           const char* args_json,
           ac_engine_reply_t reply,
           void* context,
           size_t max_bytes,
           OffTheRecord off_the_record)
    : ArgsCall(args_json, reply, context, max_bytes, off_the_record) {
  if (!ArgsCall::operator bool()) {
    return;
  }
  profile_ = ProfileAt(profile_dir ? profile_dir : "");
  if (!profile_) {
    TakeReply().Error("profile not loaded");
    return;
  }
  if (!ArgsCall::off_the_record()) {
    return;
  }
  profile_ = profile_->GetPrimaryOTRProfile(false);
  if (profile_ && profile_->ShutdownStarted()) {
    profile_ = nullptr;
  }
  if (!profile_) {
    TakeReply().Error("no private session");
  }
}

Call::~Call() = default;

ProfileState::ProfileState(Profile* profile) : profile_(profile) {
  observation_.Observe(profile);
}

ProfileState::~ProfileState() = default;

void ProfileState::OnProfileWillBeDestroyed(Profile* profile) {
  Release();
  observation_.Reset();
}

Profile* ProfileAt(std::string_view dir) {
  ProfileManager* manager =
      g_browser_process ? g_browser_process->profile_manager() : nullptr;
  if (!manager || dir.empty()) {
    return nullptr;
  }
  return manager->GetProfileByPath(base::FilePath(dir));
}

content::WebContents* TabWithId(int id) {
  content::WebContents* found = nullptr;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&](BrowserWindowInterface* browser) {
        TabStripModel* model = browser->GetTabStripModel();
        for (int i = 0; model && i < model->count(); ++i) {
          content::WebContents* contents = model->GetWebContentsAt(i);
          if (sessions::SessionTabHelper::IdForTab(contents).id() == id) {
            found = contents;
            return false;
          }
        }
        return true;
      });
  return found;
}

void Emit(std::string_view topic, Profile* profile, base::DictValue payload) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!g_sink) {
    return;
  }
  if (profile) {
    payload.Set("profile", profile->GetOriginalProfile()->GetPath().value());
    if (profile->IsOffTheRecord()) {
      payload.Set("offTheRecord", true);
    }
  }
  g_sink(g_sink_context, std::string(topic).c_str(), ToJSON(payload).c_str());
}

}

extern "C" AC_ENGINE_EXPORT int ac_engine_abi_version() {
  return AC_ENGINE_ABI_VERSION;
}

extern "C" AC_ENGINE_EXPORT void ac_engine_set_event_sink(
    ac_engine_event_t sink,
    void* context) {
  ardia::g_sink = sink;
  ardia::g_sink_context = context;
}
