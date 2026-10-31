#ifndef ARDIA_LINUX_AC_LINUX_FIND_H_
#define ARDIA_LINUX_AC_LINUX_FIND_H_

#include <string>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"
#include "components/find_in_page/find_result_observer.h"

namespace content {
class WebContents;
}

namespace ardiacore {

class LinuxFind : public find_in_page::FindResultObserver {
 public:
  LinuxFind(content::WebContents* contents,
            base::RepeatingCallback<bool()> is_current,
            base::RepeatingCallback<void(base::DictValue)> emit);
  ~LinuxFind() override;
  LinuxFind(const LinuxFind&) = delete;
  LinuxFind& operator=(const LinuxFind&) = delete;

  bool Start(const std::u16string& text, bool forward);
  bool Stop(bool clear_selection);
  void Reset();

 private:
  void OnFindResultAvailable(content::WebContents* contents) override;
  void OnFindEmptyText(content::WebContents* contents) override;
  void OnFindTabHelperDestroyed(find_in_page::FindTabHelper* helper) override;
  void Emit(int count, int active, bool final);

  base::WeakPtr<content::WebContents> contents_;
  base::RepeatingCallback<bool()> is_current_;
  base::RepeatingCallback<void(base::DictValue)> emit_;
  raw_ptr<find_in_page::FindTabHelper> observed_ = nullptr;
};

}

#endif
