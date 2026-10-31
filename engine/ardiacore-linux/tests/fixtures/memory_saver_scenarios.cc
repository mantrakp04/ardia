#include <cassert>
#include <cstdio>
#include <initializer_list>
#include <string>
#include <utility>

#include "ardia/linux/ac_linux_memory_saver.h"

using namespace ardiacore;

namespace {

base::ListValue List(std::initializer_list<const char*> items) {
  base::ListValue list;
  for (const char* item : items) list.Append(base::Value(item));
  return list;
}

base::DictValue Reply() {
  return base::DictValue()
      .Set("state", "on")
      .Set("aggressiveness", "balanced")
      .Set("active", base::Value(true))
      .Set("sites", base::Value(List({"youtube.com"})))
      .Set("invalid", base::Value(List({"[bad"})))
      .Set("extra", "dropped");
}

void Routes() {
  assert(IsLinuxMemorySaverRoute("engine.memorySaver"));
  assert(IsLinuxMemorySaverRoute("engine.validateKeepActiveSite"));
  assert(!IsLinuxMemorySaverRoute("engine.batterySaver"));
  assert(!IsLinuxMemorySaverRoute("engine.memorysaver"));
  assert(!IsLinuxMemorySaverRoute("ac_memory_saver"));
  assert(std::string(kLinuxMemorySaverService) == "ac_memory_saver");
}

void PreparesSettings() {
  auto full = PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue()
      .Set("state", "off").Set("aggressiveness", "maximum")
      .Set("sites", base::Value(List({"youtube.com", "https://mail.example.com/inbox?x=1", "", "a\nb", "a\tb"}))));
  assert(full);
  assert(*full->FindString("state") == "off");
  assert(*full->FindString("aggressiveness") == "maximum");
  assert(full->Find("sites")->GetList() == List({"youtube.com", "https://mail.example.com/inbox?x=1"}));
  assert(!full->contains("validate"));

  auto empty = PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue());
  assert(empty && empty->size() == 0);

  auto state_only = PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("state", "on"));
  assert(state_only && state_only->size() == 1);

  auto no_sites = PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("sites", base::Value(base::ListValue())));
  assert(no_sites && no_sites->Find("sites")->GetList().size() == 0);

  std::string longest(kLinuxKeepActiveSiteLength, 'a');
  std::string too_long(kLinuxKeepActiveSiteLength + 1, 'a');
  base::ListValue lengths;
  lengths.Append(base::Value(longest));
  lengths.Append(base::Value(too_long));
  auto trimmed = PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("sites", base::Value(std::move(lengths))));
  assert(trimmed && trimmed->Find("sites")->GetList().size() == 1);
}

void RejectsMalformedSettings() {
  assert(!PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("validate", "youtube.com")));
  assert(!PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("state", "default")));
  assert(!PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("state", base::Value(true))));
  assert(!PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("aggressiveness", "aggressive")));
  assert(!PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("aggressiveness", base::Value(2))));
  assert(!PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("sites", "youtube.com")));
  base::ListValue mixed = List({"youtube.com"});
  mixed.Append(base::Value(3));
  assert(!PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("sites", base::Value(std::move(mixed)))));
  base::ListValue many;
  for (std::size_t i = 0; i <= kLinuxKeepActiveSiteLimit; ++i) many.Append(base::Value("example.com"));
  assert(!PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("sites", base::Value(std::move(many)))));
  assert(!PrepareLinuxMemorySaver("engine.memorySaver", base::DictValue().Set("state", "on").Set("tab", base::Value(1))));
  assert(!PrepareLinuxMemorySaver("engine.batterySaver", base::DictValue()));
}

void PreparesValidation() {
  auto valid = PrepareLinuxMemorySaver("engine.validateKeepActiveSite", base::DictValue().Set("site", "[*.]example.com"));
  assert(valid && valid->size() == 1 && *valid->FindString("validate") == "[*.]example.com");
  assert(!PrepareLinuxMemorySaver("engine.validateKeepActiveSite", base::DictValue()));
  assert(!PrepareLinuxMemorySaver("engine.validateKeepActiveSite", base::DictValue().Set("site", "")));
  assert(!PrepareLinuxMemorySaver("engine.validateKeepActiveSite", base::DictValue().Set("site", "a\rb")));
  assert(!PrepareLinuxMemorySaver("engine.validateKeepActiveSite", base::DictValue().Set("site", base::Value(1))));
  assert(!PrepareLinuxMemorySaver("engine.validateKeepActiveSite", base::DictValue().Set("site", "youtube.com").Set("state", "on")));
  assert(!PrepareLinuxMemorySaver("engine.validateKeepActiveSite", base::DictValue().Set("validate", "youtube.com")));
}

void CompletesReplies() {
  auto state = CompleteLinuxMemorySaver("engine.memorySaver", Reply());
  assert(state && state->size() == 5 && !state->contains("extra"));
  assert(*state->FindString("state") == "on" && *state->FindString("aggressiveness") == "balanced");
  assert(state->Find("active")->GetBool());
  assert(state->Find("sites")->GetList() == List({"youtube.com"}));
  assert(state->Find("invalid")->GetList() == List({"[bad"}));

  auto bad_state = Reply();
  bad_state.Set("state", "maybe");
  assert(!CompleteLinuxMemorySaver("engine.memorySaver", bad_state));
  auto bad_mode = Reply();
  bad_mode.Set("aggressiveness", "medium");
  assert(!CompleteLinuxMemorySaver("engine.memorySaver", bad_mode));
  auto bad_active = Reply();
  bad_active.Set("active", "yes");
  assert(!CompleteLinuxMemorySaver("engine.memorySaver", bad_active));
  auto no_invalid = Reply();
  no_invalid.Remove("invalid");
  assert(!CompleteLinuxMemorySaver("engine.memorySaver", no_invalid));
  base::ListValue numbers;
  numbers.Append(base::Value(1));
  auto bad_list = Reply();
  bad_list.Set("sites", base::Value(std::move(numbers)));
  assert(!CompleteLinuxMemorySaver("engine.memorySaver", bad_list));

  auto valid = CompleteLinuxMemorySaver("engine.validateKeepActiveSite", base::DictValue().Set("valid", base::Value(false)).Set("state", "on"));
  assert(valid && valid->size() == 1 && !valid->Find("valid")->GetBool());
  assert(!CompleteLinuxMemorySaver("engine.validateKeepActiveSite", base::DictValue().Set("valid", "true")));
  assert(!CompleteLinuxMemorySaver("engine.validateKeepActiveSite", Reply()));
  assert(!CompleteLinuxMemorySaver("engine.batterySaver", Reply()));
}

}

int main() {
  Routes();
  PreparesSettings();
  RejectsMalformedSettings();
  PreparesValidation();
  CompletesReplies();
  std::puts("memory saver scenarios passed");
  return 0;
}
