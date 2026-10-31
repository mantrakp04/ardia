#include "chrome/browser/ardia/public/ac_engine.h"

#include <string_view>

#include "base/check.h"
#include "content/public/browser/browser_thread.h"

namespace {

struct Entry {
  std::string_view name;
  ac_engine_call_t call;
};

}

#include "chrome/browser/ardia/ac_engine_dispatch.inc"

extern "C" AC_ENGINE_EXPORT void ac_engine_call(const char* name,
                                                const char* profile_dir,
                                                const char* args_json,
                                                ac_engine_reply_t reply,
                                                void* context) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  if (!reply) {
    return;
  }
  if (name) {
    for (const Entry& entry : kCalls) {
      if (entry.name == name) {
        entry.call(profile_dir, args_json, reply, context);
        return;
      }
    }
  }
  reply(context, "{\"error\":\"unknown engine service\"}");
}
