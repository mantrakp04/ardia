#import "ardia/core/public/ArdiaCore.h"

#include <memory>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "base/trace_event/trace_config.h"
#include "content/public/browser/tracing_controller.h"

static bool g_tracing = false;

namespace {

struct TracingStart {
  void (^completion)(BOOL);
  bool answered = false;
  int session = 0;
};

int g_tracing_session = 0;
std::weak_ptr<TracingStart>& PendingTracingStart() {
  static base::NoDestructor<std::weak_ptr<TracingStart>> pending;
  return *pending;
}

constexpr int kTracingStartChecks = 100;

bool IsCurrent(const TracingStart& start) {
  return start.session == g_tracing_session;
}

void AnswerTracingStart(const std::shared_ptr<TracingStart>& start, bool started) {
  if (start->answered) {
    return;
  }
  start->answered = true;
  if (!started && IsCurrent(*start)) {
    g_tracing = false;
  }
  start->completion(started);
}

void WatchTracingStart(std::shared_ptr<TracingStart> start, int checks_left) {
  if (start->answered) {
    return;
  }
  if (!IsCurrent(*start)) {
    AnswerTracingStart(start, false);
    return;
  }
  content::TracingController* tracing = content::TracingController::GetInstance();
  if (!tracing->IsTracing()) {
    AnswerTracingStart(start, false);
    return;
  }
  if (checks_left == 0) {
    AnswerTracingStart(start, false);
    tracing->StopTracing(nullptr);
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE, base::BindOnce(&WatchTracingStart, std::move(start), checks_left - 1),
      base::Milliseconds(100));
}

}

@implementation ArdiaCoreEngine (Tracing)

+ (void)beginTracing:(void (^)(BOOL started))completion {
  if (g_tracing) {
    completion(NO);
    return;
  }
  auto start = std::make_shared<TracingStart>();
  start->completion = completion;
  start->session = ++g_tracing_session;
  PendingTracingStart() = start;
  g_tracing = content::TracingController::GetInstance()->StartTracing(
      base::trace_event::TraceConfig(),
      base::BindOnce(
          [](std::shared_ptr<TracingStart> start) {
            if (start->answered) {
              if (IsCurrent(*start) && !g_tracing) {
                content::TracingController::GetInstance()->StopTracing(nullptr);
              }
              return;
            }
            AnswerTracingStart(start, true);
          },
          start));
  if (!g_tracing) {
    AnswerTracingStart(start, false);
    return;
  }
  WatchTracingStart(start, kTracingStartChecks);
}

+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString* _Nullable path))completion {
  if (!g_tracing) {
    completion(nil);
    return;
  }
  g_tracing = false;
  ++g_tracing_session;
  if (std::shared_ptr<TracingStart> pending = PendingTracingStart().lock()) {
    AnswerTracingStart(pending, false);
  }
  NSDateFormatter* format = [[NSDateFormatter alloc] init];
  format.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  format.dateFormat = @"yyyy-MM-dd 'at' HH.mm.ss.SSS";
  NSString* folder =
      keep ? [NSFileManager.defaultManager URLsForDirectory:NSDownloadsDirectory
                                                  inDomains:NSUserDomainMask]
                 .firstObject.path
           : NSTemporaryDirectory();
  [NSFileManager.defaultManager createDirectoryAtPath:folder
                          withIntermediateDirectories:YES
                                           attributes:nil
                                                error:nil];
  NSString* path = [folder
      stringByAppendingPathComponent:[NSString stringWithFormat:@"Ardia Trace %@.json",
                                                                [format stringFromDate:NSDate.date]]];
  const bool stopped = content::TracingController::GetInstance()->StopTracing(
      content::TracingController::CreateFileEndpoint(
          base::FilePath(base::SysNSStringToUTF8(path)),
          base::BindOnce(
              [](NSString* path, BOOL keep, void (^completion)(NSString*)) {
                if (keep) {
                  completion(path);
                } else {
                  [NSFileManager.defaultManager removeItemAtPath:path error:nil];
                  completion(nil);
                }
              },
              path, keep, completion)));
  if (!stopped) {
    completion(nil);
  }
}

+ (BOOL)isTracing {
  return g_tracing;
}

@end
