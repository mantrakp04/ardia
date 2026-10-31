#include <glib.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <iostream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "ardia/linux/ac_linux_calendar_eds.h"

namespace {

using ardia::linux_calendar::EdsChange;
using ardia::linux_calendar::EdsResult;
using ardia::linux_calendar::EdsStatusName;

std::string Quote(const std::string& text) {
  std::string out = "\"";
  for (unsigned char c : text) {
    if (c == '"' || c == '\\') {
      out += '\\';
      out += static_cast<char>(c);
    } else if (c < 0x20) {
      char escaped[8];
      std::snprintf(escaped, sizeof(escaped), "\\u%04x", c);
      out += escaped;
    } else {
      out += static_cast<char>(c);
    }
  }
  return out + "\"";
}

std::string Status(const EdsResult& result) {
  return "\"status\":" + Quote(std::string(EdsStatusName(result.status))) + ",\"message\":" + Quote(result.message) +
         ",\"timedOut\":" + (result.timed_out ? "true" : "false");
}

long long Since(std::chrono::steady_clock::time_point started) {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
}

std::string ObjectsReply(const ardia::linux_calendar::EdsCalendarObjects& objects, long long elapsed) {
  std::string reply = "{" + Status(objects.result) + ",\"truncated\":" + (objects.truncated ? "true" : "false") +
                      ",\"elapsedMs\":" + std::to_string(elapsed) + ",\"objects\":[";
  for (size_t i = 0; i < objects.objects.size(); ++i) reply += std::string(i ? "," : "") + Quote(objects.objects[i]);
  return reply + "]}";
}

const char* ChangeName(EdsChange change) {
  switch (change) {
    case EdsChange::kObjects: return "objects";
    case EdsChange::kSources: return "sources";
    case EdsChange::kService: return "service";
  }
  return "unknown";
}

}

int main() {
  GMainContext* context = g_main_context_new();
  g_main_context_push_thread_default(context);
  std::set<std::string> changes;
  auto client = ardia::linux_calendar::SessionEdsClient([&](EdsChange change) { changes.insert(ChangeName(change)); });
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream words(line);
    std::string command;
    words >> command;
    std::string reply;
    if (command == "probe") {
      reply = "{" + Status(client->Probe()) + "}";
    } else if (command == "sources") {
      std::vector<ardia::linux_calendar::EdsSource> sources;
      const EdsResult result = client->Sources(&sources);
      reply = "{" + Status(result) + ",\"sources\":[";
      for (size_t i = 0; i < sources.size(); ++i) {
        reply += std::string(i ? "," : "") + "{\"uid\":" + Quote(sources[i].uid) + ",\"calendar\":" +
                 (ardia::linux_calendar::IsCalendarSource(sources[i]) ? "true" : "false") + ",\"data\":{";
        bool first_group = true;
        for (const auto& [group, keys] : sources[i].data) {
          reply += std::string(first_group ? "" : ",") + Quote(group) + ":{";
          first_group = false;
          bool first_key = true;
          for (const auto& [key, value] : keys) {
            reply += std::string(first_key ? "" : ",") + Quote(key) + ":" + Quote(value);
            first_key = false;
          }
          reply += "}";
        }
        reply += "}}";
      }
      reply += "]}";
    } else if (command == "objects") {
      std::string uid;
      long long start = 0;
      long long end = 0;
      int budget = ardia::linux_calendar::kRequestBudgetMs;
      size_t max_bytes = ardia::linux_calendar::kMaxReplyBytes;
      words >> uid >> start >> end;
      if (!(words >> budget)) budget = ardia::linux_calendar::kRequestBudgetMs;
      if (!(words >> max_bytes)) max_bytes = ardia::linux_calendar::kMaxReplyBytes;
      const auto started = std::chrono::steady_clock::now();
      reply = ObjectsReply(client->Objects(uid, start, end, budget, max_bytes), Since(started));
    } else if (command == "query") {
      long long start = 0;
      long long end = 0;
      words >> start >> end;
      const auto query = ardia::linux_calendar::EdsTimeRangeQuery(start, end);
      reply = "{\"query\":" + (query ? Quote(*query) : std::string("null")) + "}";
    } else if (command == "timezone") {
      std::string uid;
      std::string tzid;
      words >> uid >> tzid;
      std::string ics;
      const EdsResult result = client->Timezone(uid, tzid, &ics);
      reply = "{" + Status(result) + ",\"ics\":" + Quote(ics) + "}";
    } else if (command == "wait") {
      int milliseconds = 0;
      words >> milliseconds;
      changes.clear();
      const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(milliseconds);
      auto settle = deadline;
      while (std::chrono::steady_clock::now() < std::min(deadline, settle)) {
        if (!g_main_context_iteration(context, FALSE)) g_usleep(5000);
        if (!changes.empty() && settle == deadline) settle = std::chrono::steady_clock::now() + std::chrono::milliseconds(150);
      }
      reply = "{\"changes\":[";
      bool first = true;
      for (const auto& change : changes) {
        reply += std::string(first ? "" : ",") + Quote(change);
        first = false;
      }
      reply += "]}";
    } else {
      reply = "{\"error\":" + Quote("unknown command " + command) + "}";
    }
    std::cout << reply << std::endl;
  }
  client.reset();
  g_main_context_pop_thread_default(context);
  g_main_context_unref(context);
  return 0;
}
