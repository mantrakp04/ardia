#include "ardia/win/api.h"

#include <windows.h>

#include <optional>
#include <string>
#include <utility>

#include "ardia/win/ac_calls.h"
#include "ardia/win/host.h"
#include "ardia/win/profiles.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/ardia/ac_sensitive_args.h"
#include "chrome/browser/profiles/profile.h"

extern "C" void ac_engine_set_event_sink(ac_engine_event_t sink, void* context);

namespace ardia_win {

namespace {

ArdiaEngineEventSink g_sink = nullptr;
void* g_sink_context = nullptr;

std::string Json(const base::DictValue& dict) {
  return base::WriteJson(dict).value_or("{}");
}

void Deliver(ArdiaEngineReply reply, uintptr_t context, base::DictValue result) {
  if (reply) {
    reply(reinterpret_cast<void*>(context), Json(result).c_str());
  }
}

void SetEventSink(ArdiaEngineEventSink sink, void* context) {
  g_sink = sink;
  g_sink_context = context;
}

void HostCall(const char* verb,
              const char* args_json,
              uint64_t window_handle,
              ArdiaEngineReply reply,
              void* context) {
  Reply done = base::BindOnce(&Deliver, reply,
                              reinterpret_cast<uintptr_t>(context));
  std::optional<base::DictValue> args = base::JSONReader::ReadDict(
      args_json && *args_json ? args_json : "{}", base::JSON_PARSE_RFC);
  if (!args) {
    std::move(done).Run(Error("bad arguments"));
    return;
  }
  Host::Get()->Call(verb ? verb : "", std::move(*args),
                    reinterpret_cast<HWND>(static_cast<uintptr_t>(window_handle)),
                    std::move(done));
}

void RunEngineCall(ac_engine_call_t call,
                   bool off_the_record,
                   ardia::Secret args,
                   ArdiaEngineReply reply,
                   uintptr_t context,
                   Profile* profile) {
  if (!profile) {
    Deliver(reply, context, Error("profile not loaded"));
    return;
  }
  std::string directory =
      base::WideToUTF8(profile->GetOriginalProfile()->GetPath().value());
  if (!off_the_record) {
    call(directory.c_str(), args.value().c_str(), reply,
         reinterpret_cast<void*>(context));
    return;
  }
  std::optional<base::Value> parsed =
      base::JSONReader::Read(args.value(), base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) {
    if (parsed) {
      ardia::Cleanse(*parsed);
    }
    Deliver(reply, context, Error("bad arguments"));
    return;
  }
  parsed->GetDict().Set("offTheRecord", true);
  std::string marked = Json(parsed->GetDict());
  ardia::Cleanse(*parsed);
  call(directory.c_str(), marked.c_str(), reply,
       reinterpret_cast<void*>(context));
  ardia::Cleanse(marked);
}

void EngineCall(const char* name,
                const char* profile_name,
                const char* args_json,
                ArdiaEngineReply reply,
                void* context) {
  ac_engine_call_t call = FindEngineCall(name ? name : "");
  if (!call) {
    Deliver(reply, reinterpret_cast<uintptr_t>(context), Error("unknown call"));
    return;
  }
  std::string profile = profile_name ? profile_name : "";
  WithProfile(profile,
              base::BindOnce(
                  &RunEngineCall, call, ParseProfileName(profile).off_the_record,
                  ardia::Secret(
                      std::string(args_json && *args_json ? args_json : "{}")),
                  reply, reinterpret_cast<uintptr_t>(context)));
}

void OnEngineEvent(void* context, const char* topic, const char* json) {
  std::optional<base::DictValue> payload =
      base::JSONReader::ReadDict(json ? json : "{}", base::JSON_PARSE_RFC);
  if (!payload) {
    return;
  }
  if (const std::string* directory = payload->FindString("profile")) {
    payload->Set("profile", NameOfProfilePath(base::FilePath(
                                base::UTF8ToWide(*directory))));
  }
  base::DictValue event;
  event.Set("topic", topic ? topic : "");
  event.Set("payload", std::move(*payload));
  Emit("engine", std::move(event));
}

const ArdiaEngineApi kApi = {ARDIA_ENGINE_API_VERSION, sizeof(ArdiaEngineApi),
                             &SetEventSink, &HostCall, &EngineCall};

}

const ArdiaEngineApi* EngineApi() {
  return &kApi;
}

void WatchEngineEvents() {
  ac_engine_set_event_sink(&OnEngineEvent, nullptr);
}

void Emit(std::string_view topic, base::DictValue payload) {
  if (!g_sink) {
    return;
  }
  std::string name(topic);
  g_sink(g_sink_context, name.c_str(), Json(payload).c_str());
}

base::DictValue Error(std::string_view message) {
  base::DictValue result;
  result.Set("error", message);
  return result;
}

}
