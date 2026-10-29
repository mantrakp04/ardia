#ifndef ARDIA_LINUX_AC_LINUX_DIALOG_VIEWS_H_
#define ARDIA_LINUX_AC_LINUX_DIALOG_VIEWS_H_

#include <memory>
#include <string>

#include "ardia/linux/ac_linux_dialogs.h"
#include "base/scoped_observation.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_observer.h"

namespace ardia {

class LinuxWindowDialogs : public views::WidgetObserver {
 public:
  LinuxWindowDialogs(std::string window_id,
                     std::string profile_identity,
                     views::Widget* parent,
                     bool background);
  ~LinuxWindowDialogs() override;
  LinuxDialogController& controller() { return *controller_; }
  LinuxDialogSuspension Suspend();
  bool Resume(const LinuxDialogSuspension& suspension);
  void OnWidgetDestroying(views::Widget* widget) override;
  void OnWidgetDestroyed(views::Widget* widget) override;

 private:
  void ParentDestroyed();
  base::ScopedObservation<views::Widget, views::WidgetObserver> parent_observation_{this};
  std::unique_ptr<LinuxDialogController> controller_;
};

}

#endif
