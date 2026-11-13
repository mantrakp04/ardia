#include "ardia/linux/ac_linux_calendar_service.h"

#include <algorithm>
#include <cmath>
#include <iterator>
#include <memory>
#include <optional>
#include <set>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_calendar_eds.h"
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/location.h"
#include "base/message_loop/message_pump_type.h"
#include "base/no_destructor.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/threading/thread.h"
#include "base/time/time.h"
#include "base/timer/timer.h"

namespace ardia {

namespace {

namespace eds = linux_calendar;

constexpr std::string_view kMethods[] = {
    "ArdiaCalendar.status", "ArdiaCalendar.requestAccess", "ArdiaCalendar.sources",
    "ArdiaCalendar.objects", "ArdiaCalendar.timezones",
};
constexpr base::TimeDelta kChangeDelay = base::Milliseconds(750);
constexpr size_t kMaxCalendars = 64;
constexpr size_t kMaxIdLength = 512;
constexpr double kMaxRangeMs = 400.0 * 24 * 3600 * 1000;
constexpr double kMaxTimeMs = 8.64e15;
constexpr int kConsentLimit = 4096;

struct Reply {
  bool ok = true;
  base::Value value;
  std::optional<std::string> status;
  std::string message;
  bool broadcast = false;
  bool probe = false;
};

std::string_view StatusFor(eds::EdsStatus status) {
  switch (status) {
    case eds::EdsStatus::kOk: return "fullAccess";
    case eds::EdsStatus::kUnavailable: return "restricted";
    case eds::EdsStatus::kDenied: return "denied";
    case eds::EdsStatus::kFailed: return "fullAccess";
  }
  return "fullAccess";
}

std::string_view CodeFor(eds::EdsStatus status) {
  switch (status) {
    case eds::EdsStatus::kOk: return "";
    case eds::EdsStatus::kUnavailable: return "ERR_CALENDAR_UNAVAILABLE";
    case eds::EdsStatus::kDenied: return "ERR_CALENDAR_DENIED";
    case eds::EdsStatus::kFailed: return "ERR_CALENDAR_FAILED";
  }
  return "ERR_CALENDAR_FAILED";
}

Reply Failure(std::string_view code, std::string message, std::optional<std::string> status = std::nullopt) {
  Reply reply;
  reply.ok = false;
  reply.value = base::Value(base::DictValue().Set("code", code).Set("message", message));
  reply.broadcast = status.has_value();
  reply.status = std::move(status);
  reply.message = std::move(message);
  return reply;
}

Reply Failure(const eds::EdsResult& result) {
  return Failure(CodeFor(result.status), result.message, std::string(StatusFor(result.status)));
}

bool Number(const base::Value& value) {
  return value.is_double() || value.is_int();
}

bool ValidId(const base::Value* value) {
  return value && value->is_string() && !value->GetString().empty() && value->GetString().size() <= kMaxIdLength;
}

bool ReadConsent(const base::FilePath& documents) {
  std::string text;
  if (base::IsLink(documents.AppendASCII(kLinuxCalendarConsentDocument)) ||
      !base::ReadFileToStringWithMaxSize(documents.AppendASCII(kLinuxCalendarConsentDocument), &text, kConsentLimit)) {
    return false;
  }
  const auto parsed = base::JSONReader::Read(text, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) return false;
  return parsed->GetDict().FindInt("version") == 1 && parsed->GetDict().FindBool("connected").value_or(false);
}

bool WriteConsent(const base::FilePath& documents) {
  if (base::IsLink(documents) || !base::CreateDirectory(documents)) return false;
  const base::FilePath file = documents.AppendASCII(kLinuxCalendarConsentDocument);
  if (base::IsLink(file)) return false;
  const auto json = base::WriteJson(base::DictValue().Set("version", 1).Set("connected", true));
  return json && base::ImportantFileWriter::WriteFileAtomically(file, *json);
}

base::DictValue SourceValue(const eds::EdsSource& source) {
  base::DictValue data;
  for (const auto& [group, keys] : source.data) {
    base::DictValue entries;
    for (const auto& [key, value] : keys) entries.Set(key, value);
    data.Set(group, std::move(entries));
  }
  return base::DictValue()
      .Set("uid", source.uid)
      .Set("calendar", eds::IsCalendarSource(source))
      .Set("data", std::move(data));
}

class LinuxCalendarService {
 public:
  using Done = base::OnceCallback<void(bool, base::Value)>;

  static LinuxCalendarService& Get() {
    static base::NoDestructor<LinuxCalendarService> service;
    return *service;
  }

  void Invoke(base::FilePath documents, std::string method, base::ListValue values, Done done) {
    Start();
    documents_ = documents;
    if (method == "ArdiaCalendar.status") {
      probe_runner_->PostTaskAndReplyWithResult(
          FROM_HERE, base::BindOnce(&LinuxCalendarService::ProbeStatus, std::move(documents)),
          base::BindOnce(&LinuxCalendarService::Replied, base::Unretained(this), std::move(done)));
      return;
    }
    thread_.task_runner()->PostTaskAndReplyWithResult(
        FROM_HERE,
        base::BindOnce(&LinuxCalendarService::Run, base::Unretained(this), std::move(documents), std::move(method),
                       std::move(values)),
        base::BindOnce(&LinuxCalendarService::Replied, base::Unretained(this), std::move(done)));
  }

  base::CallbackListSubscription Subscribe(base::RepeatingCallback<void(const base::DictValue&)> listener) {
    return listeners_.Add(std::move(listener));
  }

 private:
  friend class base::NoDestructor<LinuxCalendarService>;
  LinuxCalendarService() = default;

  void Start() {
    if (thread_.IsRunning()) return;
    ui_ = base::SingleThreadTaskRunner::GetCurrentDefault();
    thread_.StartWithOptions(base::Thread::Options(base::MessagePumpType::UI, 0));
  }

  void Replied(Done done, Reply reply) {
    if (reply.probe && reply.status == "fullAccess" && status_ == "denied") {
      reply.status = status_;
      reply.message = message_;
      if (reply.value.is_dict()) {
        reply.value.GetDict().Set("status", status_);
        reply.value.GetDict().Set("message", message_);
      }
    }
    if (reply.status && (reply.broadcast || *reply.status != status_ || reply.message != message_)) {
      status_ = *reply.status;
      message_ = reply.message;
      Publish("status");
    }
    std::move(done).Run(reply.ok, std::move(reply.value));
  }

  void Changed(eds::EdsChange change) {
    pending_reason_ = change == eds::EdsChange::kObjects   ? "objects"
                      : change == eds::EdsChange::kSources ? "sources"
                                                           : "service";
    if (change == eds::EdsChange::kService) Recheck();
    if (change_timer_.IsRunning()) return;
    change_timer_.Start(FROM_HERE, kChangeDelay,
                        base::BindOnce(&LinuxCalendarService::Publish, base::Unretained(this), std::string()));
  }

  void Recheck() {
    if (documents_.empty()) return;
    probe_runner_->PostTaskAndReplyWithResult(
        FROM_HERE, base::BindOnce(&LinuxCalendarService::ProbeStatus, documents_),
        base::BindOnce(&LinuxCalendarService::Replied, base::Unretained(this), base::DoNothing()));
  }

  void Publish(std::string reason) {
    if (reason.empty()) reason = pending_reason_;
    const base::DictValue change =
        base::DictValue().Set("status", status_).Set("message", message_).Set("reason", reason);
    listeners_.Notify(change);
  }

  eds::EdsClient& Client() {
    if (!client_) {
      client_ = eds::SessionEdsClient([ui = ui_](eds::EdsChange change) {
        ui->PostTask(FROM_HERE, base::BindOnce(&LinuxCalendarService::Changed,
                                               base::Unretained(&LinuxCalendarService::Get()), change));
      });
    }
    return *client_;
  }

  Reply Run(base::FilePath documents, std::string method, base::ListValue values) {
    const bool connected = ReadConsent(documents);
    if (method == "ArdiaCalendar.requestAccess") return RequestAccess(documents);
    if (!connected) {
      return Failure("ERR_CALENDAR_NOT_CONNECTED", "Connect your calendars in Settings › Calendar first",
                     std::string("notDetermined"));
    }
    if (method == "ArdiaCalendar.sources") return Sources();
    if (method == "ArdiaCalendar.objects") return Objects(values);
    if (method == "ArdiaCalendar.timezones") return Timezones(values);
    return Failure("ERR_CALENDAR_REQUEST", "Unknown calendar request");
  }

  static Reply ProbeStatus(const base::FilePath& documents) {
    const bool connected = ReadConsent(documents);
    const eds::EdsResult probe = eds::ProbeEds();
    Reply reply;
    reply.probe = true;
    const std::string status = connected ? std::string(StatusFor(probe.status)) : "notDetermined";
    reply.value = base::Value(base::DictValue()
                                  .Set("status", status)
                                  .Set("available", probe.ok())
                                  .Set("message", probe.message));
    if (connected) {
      reply.status = status;
      reply.message = probe.message;
    }
    return reply;
  }

  Reply RequestAccess(const base::FilePath& documents) {
    if (!WriteConsent(documents)) {
      return Failure("ERR_CALENDAR_FAILED", "Ardia couldn't save the calendar connection");
    }
    std::vector<eds::EdsSource> sources;
    const eds::EdsResult result = Client().Sources(&sources);
    Remember(sources, result);
    Reply reply;
    reply.status = std::string(StatusFor(result.status));
    reply.message = result.message;
    reply.broadcast = true;
    reply.value = base::Value(base::DictValue()
                                  .Set("granted", result.ok())
                                  .Set("status", *reply.status)
                                  .Set("message", result.message));
    return reply;
  }

  Reply Sources() {
    std::vector<eds::EdsSource> sources;
    const eds::EdsResult result = Client().Sources(&sources);
    Remember(sources, result);
    if (!result.ok()) return Failure(result);
    base::ListValue list;
    for (const auto& source : sources) list.Append(SourceValue(source));
    Reply reply;
    reply.value = base::Value(base::DictValue().Set("sources", std::move(list)));
    reply.status = "fullAccess";
    return reply;
  }

  void Remember(const std::vector<eds::EdsSource>& sources, const eds::EdsResult& result) {
    if (!result.ok()) return;
    calendars_.clear();
    for (const auto& source : sources) {
      if (eds::IsCalendarSource(source)) calendars_.insert(source.uid);
    }
  }

  Reply Objects(const base::ListValue& values) {
    if (values.size() != 3 || !values[0].is_list() || !Number(values[1]) || !Number(values[2])) {
      return Failure("ERR_CALENDAR_REQUEST", "Calendar objects need calendar ids, a start and an end");
    }
    const double start = values[1].GetDouble();
    const double end = values[2].GetDouble();
    const base::ListValue& ids = values[0].GetList();
    if (!std::isfinite(start) || !std::isfinite(end) || std::fabs(start) > kMaxTimeMs || std::fabs(end) > kMaxTimeMs ||
        end <= start || end - start > kMaxRangeMs || ids.size() > kMaxCalendars) {
      return Failure("ERR_CALENDAR_REQUEST", "That calendar range isn't valid");
    }
    for (const auto& id : ids) {
      if (!ValidId(&id)) return Failure("ERR_CALENDAR_REQUEST", "Calendar ids must be strings");
    }
    if (calendars_.empty()) {
      std::vector<eds::EdsSource> sources;
      const eds::EdsResult listed = Client().Sources(&sources);
      if (!listed.ok()) return Failure(listed);
      Remember(sources, listed);
    }
    const base::TimeTicks deadline = base::TimeTicks::Now() + base::Milliseconds(eds::kRequestBudgetMs);
    base::DictValue calendars;
    size_t unavailable = 0;
    size_t used = 0;
    bool truncated = false;
    for (const auto& id : ids) {
      const std::string& uid = id.GetString();
      if (!calendars_.contains(uid)) {
        calendars.Set(uid, base::DictValue().Set("status", "failed").Set("message", "No such calendar"));
        continue;
      }
      const int budget = static_cast<int>(std::max<int64_t>(0, (deadline - base::TimeTicks::Now()).InMilliseconds()));
      const eds::EdsCalendarObjects objects = Client().Objects(
          uid, static_cast<int64_t>(start), static_cast<int64_t>(end), budget, eds::kMaxReplyBytes - used);
      if (objects.result.status == eds::EdsStatus::kUnavailable) ++unavailable;
      truncated = truncated || objects.truncated;
      base::ListValue list;
      for (const auto& object : objects.objects) {
        used += object.size();
        list.Append(object);
      }
      calendars.Set(uid, base::DictValue()
                             .Set("status", eds::EdsStatusName(objects.result.status))
                             .Set("message", objects.result.message)
                             .Set("timedOut", objects.result.timed_out)
                             .Set("truncated", objects.truncated)
                             .Set("objects", std::move(list)));
    }
    if (unavailable && unavailable == ids.size()) {
      return Failure("ERR_CALENDAR_UNAVAILABLE", "Evolution Data Server stopped answering", std::string("restricted"));
    }
    Reply reply;
    reply.value = base::Value(base::DictValue().Set("calendars", std::move(calendars)).Set("truncated", truncated));
    reply.status = "fullAccess";
    return reply;
  }

  Reply Timezones(const base::ListValue& values) {
    if (values.size() != 2 || !ValidId(&values[0]) || !values[1].is_list() ||
        values[1].GetList().size() > eds::kMaxTimezones) {
      return Failure("ERR_CALENDAR_REQUEST", "Time zones need a calendar id and up to 64 time zone ids");
    }
    const std::string& uid = values[0].GetString();
    if (!calendars_.contains(uid)) return Failure("ERR_CALENDAR_REQUEST", "No such calendar");
    base::DictValue zones;
    for (const auto& tzid : values[1].GetList()) {
      if (!ValidId(&tzid)) return Failure("ERR_CALENDAR_REQUEST", "Time zone ids must be strings");
      std::string ics;
      const eds::EdsResult result = Client().Timezone(uid, tzid.GetString(), &ics);
      if (result.ok() && !ics.empty() && ics.size() <= eds::kMaxObjectBytes) zones.Set(tzid.GetString(), ics);
      else zones.Set(tzid.GetString(), base::Value());
    }
    Reply reply;
    reply.value = base::Value(base::DictValue().Set("timezones", std::move(zones)));
    return reply;
  }

  base::Thread thread_{"ArdiaCalendar"};
  scoped_refptr<base::SequencedTaskRunner> probe_runner_ = base::ThreadPool::CreateSequencedTaskRunner(
      {base::MayBlock(), base::TaskPriority::USER_VISIBLE, base::TaskShutdownBehavior::CONTINUE_ON_SHUTDOWN});
  base::FilePath documents_;
  scoped_refptr<base::SingleThreadTaskRunner> ui_;
  std::unique_ptr<eds::EdsClient> client_;
  std::set<std::string> calendars_;
  std::string status_ = "unknown";
  std::string message_;
  std::string pending_reason_;
  base::OneShotTimer change_timer_;
  base::RepeatingCallbackList<void(const base::DictValue&)> listeners_;
};

}

bool LinuxCalendarInvokes(std::string_view method) {
  return std::ranges::find(kMethods, method) != std::end(kMethods);
}

void AppendLinuxCalendarCapabilities(base::ListValue& capabilities) {
  for (std::string_view method : kMethods) capabilities.Append(method);
}

void LinuxCalendarInvoke(const base::FilePath& documents, const std::string& method, const base::ListValue& values,
                         base::OnceCallback<void(bool, base::Value)> done) {
  LinuxCalendarService::Get().Invoke(documents, method, values.Clone(), std::move(done));
}

base::CallbackListSubscription WatchLinuxCalendar(base::RepeatingCallback<void(const base::DictValue&)> listener) {
  return LinuxCalendarService::Get().Subscribe(std::move(listener));
}

}
