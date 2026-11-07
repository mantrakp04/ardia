#include <cassert>
#include <string>
#include <vector>
#include "ardia/linux/ac_linux_dialog_views.h"
#include "dialog_views.h"

using namespace ardia;
base::DictValue Request(const std::string& id, bool prompt = false) {
  base::DictValue options;
  options.Set("title", "Delete Profile?");
  options.Set("message", "Cannot undo");
  options.Set("confirmTitle", "Delete Profile");
  options.Set("cancelTitle", "Keep Profile");
  options.Set("suppression", "Don’t ask me again");
  options.Set("destructive", true);
  options.Set("value", "Initial");
  options.Set("placeholder", "Name");
  base::DictValue request;
  request.Set("dialogId", id);
  request.Set("kind", prompt ? "prompt" : "confirm");
  request.Set("options", std::move(options));
  return request;
}

int main() {
  std::vector<base::DictValue> results;
  const LinuxDialogClient client{"a", "default", "1", true, true};
  std::string error;
  views::Widget parent;
  LinuxWindowDialogs dialogs("a", "default", &parent, false);
  auto& controller = dialogs.controller();
  assert(controller.ReplaceRenderer("1"));
  auto done = [&](auto value) { results.push_back(std::move(value)); };
  assert(controller.Begin(client, Request("dialog:views-identity1"), done, &error));
  auto* widget = views::Widget::latest;
  auto* box = static_cast<views::MessageBoxView*>(widget->contents.get());
  assert(widget->delegate->title == u"Delete Profile?");
  assert(widget->delegate->ok == u"Delete Profile" && widget->delegate->cancel == u"Keep Profile");
  assert(widget->delegate->button.bg == ui::kColorAlertHighSeverity);
  assert(widget->delegate->modal == ui::mojom::ModalType::kWindow);
  box->checked = true;
  widget->RequestClose(views::Widget::ClosedReason::kCancelButtonClicked);
  assert(results.empty());
  base::SingleThreadTaskRunner::GetCurrentDefault()->Drain();
  assert(results.size() == 1);
  auto* result = results.back().FindDict("data")->FindDict("result");
  assert(!result->Find("confirmed")->GetBool() && result->Find("suppressed")->GetBool());
  assert(controller.Begin(client, Request("dialog:views-identity2", true), done, &error));
  widget = views::Widget::latest;
  box = static_cast<views::MessageBoxView*>(widget->contents.get());
  assert(box->field.selected && box->field.placeholder == u"Name");
  assert(widget->delegate->focus == &box->field && box->value == u"Initial");
  box->value = u" Renamed ";
  widget->RequestClose(views::Widget::ClosedReason::kAcceptButtonClicked);
  base::SingleThreadTaskRunner::GetCurrentDefault()->Drain();
  assert(results.back().FindDict("data")->FindString("result") && *results.back().FindDict("data")->FindString("result") == "Renamed");
  assert(controller.Begin(client, Request("dialog:views-identity3"), done, &error));
  widget = views::Widget::latest;
  static_cast<views::MessageBoxView*>(widget->contents.get())->checked = true;
  widget->CloseNow();
  base::SingleThreadTaskRunner::GetCurrentDefault()->Drain();
  result = results.back().FindDict("data")->FindDict("result");
  assert(!result->Find("confirmed")->GetBool() && !result->Find("suppressed")->GetBool());
  assert(controller.Begin(client, Request("dialog:views-identity4"), done, &error));
  assert(controller.Begin(client, Request("dialog:views-identity5"), done, &error));
  parent.CloseNow();
  assert(controller.pending() == 0 && results.size() == 5);
  base::SingleThreadTaskRunner::GetCurrentDefault()->Drain();
  assert(results.size() == 5);
  views::Widget hidden_parent;
  LinuxWindowDialogs hidden("a", "default", &hidden_parent, true);
  assert(hidden.controller().ReplaceRenderer("1"));
  int shown = views::Widget::shown;
  assert(hidden.controller().Begin(client, Request("dialog:hidden-identity"), done, &error));
  assert(views::Widget::shown == shown);
  assert(!results.back().FindDict("data")->FindDict("result")->Find("confirmed")->GetBool());
  views::Widget suspended_parent;
  LinuxWindowDialogs suspended("a", "default", &suspended_parent, false);
  auto& suspended_controller = suspended.controller();
  assert(suspended_controller.ReplaceRenderer("1"));
  const size_t before = results.size();
  assert(suspended_controller.Begin(client, Request("dialog:suspend-shown"), done, &error));
  assert(suspended_controller.Begin(client, Request("dialog:suspend-queued"), done, &error));
  shown = views::Widget::shown;
  const auto suspension = suspended.Suspend();
  assert(suspension && results.size() == before + 2 && suspended_controller.pending() == 0);
  assert(views::Widget::shown == shown);
  base::SingleThreadTaskRunner::GetCurrentDefault()->Drain();
  assert(results.size() == before + 2);
  assert(!suspended_controller.Begin(client, Request("dialog:suspend-refused"), done, &error));
  assert(suspended_controller.ReplaceRenderer("2"));
  const LinuxDialogClient replacement{"a", "default", "2", true, true};
  assert(!suspended_controller.Begin(replacement, Request("dialog:suspend-replaced"), done, &error));
  assert(!suspended.Resume(LinuxDialogSuspension()));
  assert(suspended.Resume(suspension));
  assert(suspended_controller.Begin(replacement, Request("dialog:suspend-resumed"), done, &error));
  views::Widget::latest->RequestClose(views::Widget::ClosedReason::kAcceptButtonClicked);
  base::SingleThreadTaskRunner::GetCurrentDefault()->Drain();
  assert(results.size() == before + 3);
  assert(results.back().FindDict("data")->FindDict("result")->Find("confirmed")->GetBool());
  assert(suspended_controller.Begin(replacement, Request("dialog:suspend-closing"), done, &error));
  const auto closing = suspended.Suspend();
  assert(results.size() == before + 4);
  suspended_parent.CloseNow();
  base::SingleThreadTaskRunner::GetCurrentDefault()->Drain();
  assert(results.size() == before + 4 && suspended_controller.pending() == 0);
  assert(suspended.Resume(closing));
  assert(!suspended_controller.Begin(replacement, Request("dialog:suspend-after-close"), done, &error));
  base::DictValue identity;
  assert(!suspended_controller.Identify(replacement, &identity));
}
