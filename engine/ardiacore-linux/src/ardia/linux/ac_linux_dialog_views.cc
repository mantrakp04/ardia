#include "ardia/linux/ac_linux_dialog_views.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "content/public/browser/browser_thread.h"
#include "ui/base/mojom/dialog_button.mojom.h"
#include "ui/base/mojom/ui_base_types.mojom.h"
#include "ui/color/color_id.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/message_box_view.h"
#include "ui/views/controls/textfield/textfield.h"
#include "ui/views/window/dialog_delegate.h"

namespace ardia {
namespace {

class DialogSurface : public LinuxDialogSurface, public views::WidgetObserver {
 public:
  DialogSurface(views::Widget* parent, const LinuxDialogSpec& spec,
                LinuxDialogResponder responder)
      : responder_(std::move(responder)) {
    DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
    delegate_ = std::make_unique<views::DialogDelegate>();
    delegate_->SetOwnershipOfNewWidget(views::Widget::InitParams::CLIENT_OWNS_WIDGET);
    delegate_->SetTitle(base::UTF8ToUTF16(spec.title));
    delegate_->SetModalType(ui::mojom::ModalType::kWindow);
    delegate_->SetButtonLabel(ui::mojom::DialogButton::kOk, base::UTF8ToUTF16(spec.confirm_title));
    delegate_->SetButtonLabel(ui::mojom::DialogButton::kCancel, base::UTF8ToUTF16(spec.cancel_title));
    auto message = std::make_unique<views::MessageBoxView>(base::UTF8ToUTF16(spec.message));
    message_ = message.get();
    if (spec.has_suppression) message_->SetCheckBoxLabel(base::UTF8ToUTF16(spec.suppression));
    if (spec.prompt) {
      message_->SetPromptField(base::UTF8ToUTF16(spec.value));
      auto* field = message_->GetVisiblePromptField();
      field->SetPlaceholderText(base::UTF8ToUTF16(spec.placeholder));
      field->SelectAll(false);
      delegate_->SetInitiallyFocusedView(field);
    }
    delegate_->SetContentsView(std::move(message));
    widget_.reset(views::DialogDelegate::CreateDialogWidget(
        delegate_.get(), parent->GetNativeWindow(), parent->GetNativeView()));
    widget_observation_.Observe(widget_.get());
    widget_->MakeCloseSynchronous(base::BindOnce(
        &DialogSurface::OnClose, weak_factory_.GetWeakPtr()));
    if (spec.destructive) {
      auto* button = delegate_->GetOkButton();
      button->SetBgColorIdOverride(ui::kColorAlertHighSeverity);
      button->SetEnabledTextColors(ui::kColorDialogBackground);
    }
    widget_->Show();
  }

  ~DialogSurface() override {
    DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
    weak_factory_.InvalidateWeakPtrs();
    widget_observation_.Reset();
    widget_.reset();
  }

  void OnWidgetDestroying(views::Widget* widget) override {
    Forced();
  }

  void OnWidgetDestroyed(views::Widget* widget) override {
    widget_observation_.Reset();
    Forced();
  }

 private:
  static void Post(LinuxDialogResponder responder, LinuxDialogResponse response) {
    if (!responder) return;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(std::move(responder), std::move(response)));
  }

  void Forced() {
    DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
    message_ = nullptr;
    Post(std::move(responder_), {.forced = true});
  }

  void OnClose(views::Widget::ClosedReason reason) {
    DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
    LinuxDialogResponse response;
    response.accepted = reason == views::Widget::ClosedReason::kAcceptButtonClicked;
    if (message_) {
      response.suppressed = message_->IsCheckBoxSelected();
      response.text = base::UTF16ToUTF8(message_->GetInputText());
    }
    auto responder = std::move(responder_);
    widget_observation_.Reset();
    message_ = nullptr;
    widget_.reset();
    Post(std::move(responder), std::move(response));
  }

  LinuxDialogResponder responder_;
  std::unique_ptr<views::DialogDelegate> delegate_;
  std::unique_ptr<views::Widget> widget_;
  raw_ptr<views::MessageBoxView> message_ = nullptr;
  base::ScopedObservation<views::Widget, views::WidgetObserver> widget_observation_{this};
  base::WeakPtrFactory<DialogSurface> weak_factory_{this};
};

std::unique_ptr<LinuxDialogSurface> Present(base::WeakPtr<views::Widget> parent,
    bool background, const LinuxDialogSpec& spec, LinuxDialogResponder responder) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (background) {
    LOG(WARNING) << "[ardiacore] dialog (background run, not shown): \"" << spec.title << "\" ("
                 << spec.confirm_title << " / " << spec.cancel_title << "): " << spec.cancel_title;
  }
  if (background || !parent || parent->IsClosed() || parent->is_destroying()) {
    std::move(responder).Run({.forced = true});
    return nullptr;
  }
  return std::make_unique<DialogSurface>(parent.get(), spec, std::move(responder));
}

}

LinuxWindowDialogs::LinuxWindowDialogs(std::string window_id,
    std::string profile_identity, views::Widget* parent, bool background) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  controller_ = std::make_unique<LinuxDialogController>(std::move(window_id),
      std::move(profile_identity), base::BindRepeating(&Present,
          parent ? parent->GetWeakPtr() : base::WeakPtr<views::Widget>(), background));
  if (parent && !parent->is_destroying() && !parent->IsClosed()) parent_observation_.Observe(parent);
  else controller_->ParentDestroyed();
}

LinuxWindowDialogs::~LinuxWindowDialogs() {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  parent_observation_.Reset();
}

LinuxDialogSuspension LinuxWindowDialogs::Suspend() {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  return controller_->Suspend();
}

bool LinuxWindowDialogs::Resume(const LinuxDialogSuspension& suspension) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  return controller_->Resume(suspension);
}

void LinuxWindowDialogs::ParentDestroyed() {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  parent_observation_.Reset();
  controller_->ParentDestroyed();
}

void LinuxWindowDialogs::OnWidgetDestroying(views::Widget* widget) {
  ParentDestroyed();
}

void LinuxWindowDialogs::OnWidgetDestroyed(views::Widget* widget) {
  ParentDestroyed();
}

}
