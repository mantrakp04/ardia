#include <cstdio>
#include <iostream>
#include <string>

#include "ardia/linux/ac_linux_sync_crypto.h"
#include "ardia/linux/ac_linux_sync.h"
#include "ardia/linux/ac_linux_sync_json.h"
#include "ardia/linux/ac_linux_sync_keystore.h"
#include "ardia/linux/ac_linux_sync_vault.h"

using namespace ardia::linux_sync;

int main(int argc, char** argv) {
  if (argc < 4) {
    std::fprintf(stderr, "usage: sync_device_tool <key dir> <default folder> <device name>\n");
    return 2;
  }
  SyncCore core(MakeFileKeyStore(argv[1]), {argv[2], argv[3]});
  std::string line;
  while (std::getline(std::cin, line)) {
    auto request = ParseJson(line);
    JsonValue reply;
    if (!request || !request->Find("method") || !request->Find("args") || !request->Find("args")->is_array()) {
      reply = JsonValue::Object({{"ok", JsonValue::Bool(false)}, {"code", JsonValue::String("ERR_TOOL")}});
    } else {
      Outcome outcome = core.Dispatch(request->Find("method")->text, request->Find("args")->items, NowSeconds());
      reply = outcome.ok ? JsonValue::Object({{"ok", JsonValue::Bool(true)}, {"value", std::move(outcome.value)}})
                         : JsonValue::Object({{"ok", JsonValue::Bool(false)},
                                              {"code", JsonValue::String(outcome.code)},
                                              {"message", JsonValue::String(outcome.message)}});
    }
    std::cout << WriteJson(reply) << std::endl;
  }
  return 0;
}
