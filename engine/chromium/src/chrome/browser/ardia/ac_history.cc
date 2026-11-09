// Copyright 2026 Ardia. Apache-2.0.

#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/cancelable_task_tracker.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/history/history_service_factory.h"
#include "chrome/browser/history/history_utils.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/profiles/profile.h"
#include "components/history/core/browser/history_backend.h"
#include "components/history/core/browser/history_database.h"
#include "components/history/core/browser/history_db_task.h"
#include "components/history/core/browser/history_service.h"
#include "components/history/core/browser/history_service_observer.h"
#include "components/history/core/browser/history_types.h"
#include "components/keyed_service/core/service_access_type.h"
#include "ui/base/page_transition_types.h"
#include "url/gurl.h"

namespace ardia {

namespace {

const base::ListValue& EmptyList() {
  static base::NoDestructor<base::ListValue> empty;
  return *empty;
}

constexpr size_t kDefaultMaxUrls = 5000;
constexpr size_t kDefaultMaxVisits = 50;

base::CancelableTaskTracker& Tracker() {
  static base::NoDestructor<base::CancelableTaskTracker> tracker;
  return *tracker;
}

history::HistoryService* HistoryFor(Profile* profile) {
  if (!profile || profile->IsOffTheRecord()) {
    return nullptr;
  }
  return HistoryServiceFactory::GetForProfile(
      profile, ServiceAccessType::EXPLICIT_ACCESS);
}

double Ms(base::Time time) {
  return std::floor(time.InMillisecondsFSinceUnixEpoch());
}

bool Visible(ui::PageTransition transition) {
  return (transition & ui::PAGE_TRANSITION_CHAIN_END) &&
         !ui::PageTransitionCoreTypeIs(transition,
                                       ui::PAGE_TRANSITION_AUTO_SUBFRAME) &&
         !ui::PageTransitionCoreTypeIs(transition,
                                       ui::PAGE_TRANSITION_MANUAL_SUBFRAME);
}

base::DictValue Row(const history::URLRow& row) {
  return base::DictValue()
      .Set("u", row.url().spec())
      .Set("t", base::UTF16ToUTF8(row.title()))
      .Set("n", row.visit_count());
}

constexpr base::TimeDelta kBatchDelay = base::Milliseconds(20);
constexpr size_t kBatchMax = 2000;

class Watcher : public ProfileState, public history::HistoryServiceObserver {
 public:
  explicit Watcher(Profile* profile) : ProfileState(profile) {}

  void Start(history::HistoryService* service) {
    if (!observation_.IsObserving()) {
      observation_.Observe(service);
    }
  }

  void OnURLVisited(history::HistoryService*,
                    const history::VisitedURLInfo& info) override {
    if (!Visible(info.visit_row.transition) || info.url_row.hidden()) {
      return;
    }
    Add(Row(info.url_row)
            .Set("kind", "visit")
            .Set("at", Ms(info.visit_row.visit_time)));
  }

  void OnURLsModified(history::HistoryService*,
                      const history::URLRows& changed) override {
    base::ListValue rows;
    for (const auto& row : changed) {
      rows.Append(Row(row));
    }
    Add(base::DictValue().Set("kind", "modified").Set("rows", std::move(rows)));
  }

  void OnHistoryDeletions(history::HistoryService*,
                          const history::DeletionInfo& info) override {
    base::ListValue urls;
    const bool whole_urls = !info.time_range().IsValid() &&
                            !info.IsAllHistory();
    if (whole_urls) {
      for (const auto& row : info.deleted_rows()) {
        urls.Append(row.url().spec());
      }
    }
    Add(base::DictValue()
            .Set("kind", "deleted")
            .Set("all", !whole_urls)
            .Set("urls", std::move(urls)));
  }

  void HistoryServiceBeingDeleted(history::HistoryService*) override {
    Flush();
    observation_.Reset();
  }

 private:
  void Release() override {
    flush_.Stop();
    observation_.Reset();
  }

  void Add(base::DictValue change) {
    pending_.Append(std::move(change));
    if (pending_.size() >= kBatchMax) {
      Flush();
    } else if (!flush_.IsRunning()) {
      flush_.Start(FROM_HERE, kBatchDelay,
                   base::BindOnce(&Watcher::Flush, base::Unretained(this)));
    }
  }

  void Flush() {
    flush_.Stop();
    if (pending_.empty()) {
      return;
    }
    Emit("history.changed", profile(),
         base::DictValue().Set("kind", "batch").Set("changes",
                                                    std::move(pending_)));
    pending_ = base::ListValue();
  }

  base::ListValue pending_;
  base::OneShotTimer flush_;
  base::ScopedObservation<history::HistoryService,
                          history::HistoryServiceObserver>
      observation_{this};
};

struct Page {
  GURL url;
  std::u16string title;
  std::vector<base::Time> visits;
};

class MissingVisitsTask : public history::HistoryDBTask {
 public:
  MissingVisitsTask(std::vector<Page> pages,
                    base::TimeDelta tolerance,
                    base::OnceCallback<void(std::vector<Page>)> done)
      : pages_(std::move(pages)),
        tolerance_(tolerance),
        done_(std::move(done)) {}

  bool RunOnDBThread(history::HistoryBackend*,
                     history::HistoryDatabase* db) override {
    for (Page& page : pages_) {
      history::URLRow row;
      const history::URLID id = db->GetRowForURL(page.url, &row);
      if (!id) {
        continue;
      }
      history::VisitVector existing;
      db->GetVisitsForURL(id, &existing);
      std::vector<base::Time> times;
      for (const auto& visit : existing) {
        times.push_back(visit.visit_time);
      }
      std::sort(times.begin(), times.end());
      std::sort(page.visits.begin(), page.visits.end());
      std::vector<bool> used(times.size(), false);
      std::vector<base::Time> missing;
      size_t from = 0;
      for (base::Time t : page.visits) {
        while (from < times.size() && times[from] < t - tolerance_) {
          from++;
        }
        size_t match = from;
        while (match < times.size() && times[match] <= t + tolerance_ &&
               used[match]) {
          match++;
        }
        if (match < times.size() && times[match] <= t + tolerance_) {
          used[match] = true;
        } else {
          missing.push_back(t);
        }
      }
      page.visits = std::move(missing);
      if (!row.title().empty()) {
        page.title.clear();
      }
    }
    return true;
  }

  void DoneRunOnMainThread() override {
    std::move(done_).Run(std::move(pages_));
  }

 private:
  std::vector<Page> pages_;
  base::TimeDelta tolerance_;
  base::OnceCallback<void(std::vector<Page>)> done_;
};

}

}

using ardia::Call;
using ardia::Reply;

AC_PROFILE_CALL(ac_history_query) {
  history::HistoryService* service = ardia::HistoryFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no history");
  }
  const size_t max_urls = static_cast<size_t>(
      call.Double("maxUrls", ardia::kDefaultMaxUrls));
  const size_t max_visits = static_cast<size_t>(
      call.Double("maxVisits", ardia::kDefaultMaxVisits));
  history::QueryOptions options;
  options.duplicate_policy = history::QueryOptions::KEEP_ALL_DUPLICATES;
  options.max_count = 0;
  service->QueryHistory(
      std::u16string(), options,
      base::BindOnce(
          [](Reply reply, size_t max_urls, size_t max_visits,
             history::QueryResults results) {
            struct Entry {
              const history::URLResult* row;
              std::vector<double> visits;
            };
            std::vector<Entry> entries;
            std::map<GURL, size_t> index;
            for (const auto& result : results) {
              auto [it, added] = index.try_emplace(result.url(), entries.size());
              if (added) {
                if (entries.size() >= max_urls) {
                  index.erase(it);
                  continue;
                }
                entries.push_back({&result, {}});
              }
              auto& visits = entries[it->second].visits;
              if (visits.size() < max_visits) {
                visits.push_back(ardia::Ms(result.visit_time()));
              }
            }
            base::ListValue list;
            for (auto& entry : entries) {
              base::ListValue visits;
              for (auto t = entry.visits.rbegin(); t != entry.visits.rend();
                   ++t) {
                visits.Append(*t);
              }
              list.Append(ardia::Row(*entry.row).Set("v", std::move(visits)));
            }
            reply.Send(base::DictValue().Set("entries", std::move(list)));
          },
          call.TakeReply(), max_urls, max_visits),
      &ardia::Tracker());
}

AC_PROFILE_CALL(ac_history_add) {
  history::HistoryService* service = ardia::HistoryFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no history");
  }
  std::vector<ardia::Page> pages;
  const base::ListValue* list = call.args().FindList("pages");
  for (const base::Value& value : list ? *list : ardia::EmptyList()) {
    if (!value.is_dict()) {
      continue;
    }
    const base::DictValue& dict = value.GetDict();
    const std::string* url = dict.FindString("u");
    const std::string* title = dict.FindString("t");
    const base::ListValue* visits = dict.FindList("v");
    GURL gurl(url ? *url : std::string());
    if (!gurl.is_valid() || !CanAddURLToHistory(gurl) || !visits) {
      continue;
    }
    ardia::Page page{gurl, title ? base::UTF8ToUTF16(*title) : u"", {}};
    for (const base::Value& at : *visits) {
      if (at.is_double() || at.is_int()) {
        page.visits.push_back(
            base::Time::FromMillisecondsSinceUnixEpoch(at.GetDouble()));
      }
    }
    if (!page.visits.empty()) {
      pages.push_back(std::move(page));
    }
  }
  const base::TimeDelta tolerance =
      base::Milliseconds(std::max(0.0, call.Double("toleranceMs", 1000)));
  service->ScheduleDBTask(
      FROM_HERE,
      std::make_unique<ardia::MissingVisitsTask>(
          std::move(pages), tolerance,
          base::BindOnce(
              [](Reply reply, base::WeakPtr<history::HistoryService> service,
                 std::vector<ardia::Page> pages) {
                if (!service) {
                  return reply.Error("history went away");
                }
                int added = 0;
                for (const auto& page : pages) {
                  for (size_t i = 0; i < page.visits.size(); ++i) {
                    history::HistoryAddPageArgs args(
                        page.url, page.visits[i], 0,
                        0, std::nullopt,
                        GURL(), history::RedirectList(),
                        ui::PageTransitionFromInt(
                            ui::PAGE_TRANSITION_LINK |
                            ui::PAGE_TRANSITION_CHAIN_START |
                            ui::PAGE_TRANSITION_CHAIN_END),
                        false, history::SOURCE_BROWSED,
                        history::VisitResponseCodeCategory::kNot404,
                        false,
                        true);
                    if (i == page.visits.size() - 1 && !page.title.empty()) {
                      args.title = page.title;
                    }
                    service->AddPage(std::move(args));
                    added++;
                  }
                }
                reply.Send(base::DictValue().Set("added", added));
              },
              call.TakeReply(), service->AsWeakPtr())),
      &ardia::Tracker());
}

AC_PROFILE_CALL(ac_history_import) {
  history::HistoryService* service = ardia::HistoryFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no history");
  }
  history::URLRows rows;
  const base::ListValue* list = call.args().FindList("rows");
  for (const base::Value& value : list ? *list : ardia::EmptyList()) {
    if (!value.is_dict()) {
      continue;
    }
    const base::DictValue& dict = value.GetDict();
    const std::string* url = dict.FindString("u");
    GURL gurl(url ? *url : std::string());
    const double last = dict.FindDouble("l").value_or(0);
    if (!gurl.is_valid() || !CanAddURLToHistory(gurl) || last <= 0) {
      continue;
    }
    history::URLRow row(gurl);
    if (const std::string* title = dict.FindString("t")) {
      row.set_title(base::UTF8ToUTF16(*title));
    }
    row.set_visit_count(std::max(1, dict.FindInt("n").value_or(1)));
    row.set_last_visit(base::Time::FromMillisecondsSinceUnixEpoch(last));
    rows.push_back(std::move(row));
  }
  service->AddPagesWithDetails(rows, history::SOURCE_BROWSED);
  call.TakeReply().Ok();
}

AC_PROFILE_CALL(ac_history_delete_urls) {
  history::HistoryService* service = ardia::HistoryFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no history");
  }
  std::vector<GURL> urls;
  const base::ListValue* list = call.args().FindList("urls");
  for (const base::Value& value : list ? *list : ardia::EmptyList()) {
    if (value.is_string() && GURL(value.GetString()).is_valid()) {
      urls.emplace_back(value.GetString());
    }
  }
  service->DeleteURLs(urls);
  call.TakeReply().Ok();
}

AC_PROFILE_CALL(ac_history_watch) {
  history::HistoryService* service = ardia::HistoryFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no history");
  }
  ardia::StateFor<ardia::Watcher>(call.profile()).Start(service);
  call.TakeReply().Ok();
}
