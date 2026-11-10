#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "Events.h"
#include "MenuKeyboard.h"
#include "MenuPopup.h"
#include "MenuStore.h"
#include "NativeModules.h"
#include "WindowManager.h"

namespace Ardia {

REACT_MODULE(MenusModule, L"ArdiaMenus")
struct MenusModule {
  using JSValue = winrt::Microsoft::ReactNative::JSValue;
  using Promise = winrt::Microsoft::ReactNative::ReactPromise<JSValue>;
  using DonePromise = winrt::Microsoft::ReactNative::ReactPromise<void>;

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
    Menus::MenuKeyboard::Shared().context = context;
    RunOnUI(context, []() noexcept { Menus::MenuKeyboard::Shared().Install(); });
  }

  REACT_METHOD(showMenu)
  void showMenu(JSValue items, Promise promise) noexcept {
    auto parsed = std::make_shared<std::vector<Menus::PopupItem>>(Menus::PopupItemsOf(items));
    RunOnUI(m_context, [parsed, promise]() noexcept {
      try {
        if (Menus::TestFlag(L"appMenu")) {
          std::optional<std::string> pick = Menus::TestPick(*parsed);
          promise.Resolve(pick ? JSValue{std::string{*pick}} : JSValue{nullptr});
          return;
        }
        if (WindowManager::Background()) {
          Menus::ReportUnshownMenu(*parsed);
          promise.Resolve(JSValue{nullptr});
          return;
        }
        Menus::MenuKeyboard &keyboard = Menus::MenuKeyboard::Shared();
        keyboard.trackingMenu = true;
        std::optional<std::string> chosen = Menus::TrackPopup(*parsed, Menus::MenuOwnerWindow());
        keyboard.trackingMenu = false;
        promise.Resolve(chosen ? JSValue{std::string{*chosen}} : JSValue{nullptr});
      } catch (...) {
        Menus::MenuKeyboard::Shared().trackingMenu = false;
        promise.Resolve(JSValue{nullptr});
      }
    });
  }

  REACT_METHOD(setMenuState)
  void setMenuState(JSValue state, DonePromise promise) noexcept {
    auto shared = std::make_shared<JSValue>(std::move(state));
    RunOnUI(m_context, [shared, promise]() noexcept {
      Menus::MenuStore::Shared().Update(*shared);
      promise.Resolve();
    });
  }

  REACT_METHOD(setMenuBookmarks)
  void setMenuBookmarks(JSValue bookmarks, DonePromise promise) noexcept {
    auto shared = std::make_shared<JSValue>(std::move(bookmarks));
    RunOnUI(m_context, [shared, promise]() noexcept {
      Menus::MenuStore::Shared().UpdateBookmarks(*shared);
      promise.Resolve();
    });
  }

  REACT_METHOD(menuShortcuts)
  void menuShortcuts(Promise promise) noexcept {
    RunOnUI(m_context, [promise]() noexcept { promise.Resolve(Menus::MenuStore::Shared().ShortcutList()); });
  }

  REACT_METHOD(activeShortcuts)
  void activeShortcuts(Promise promise) noexcept {
    RunOnUI(m_context, [promise]() noexcept { promise.Resolve(Menus::MenuStore::Shared().ActiveBindings()); });
  }

  REACT_METHOD(recordShortcut)
  void recordShortcut(Promise promise) noexcept {
    RunOnUI(m_context, [promise]() noexcept { Menus::MenuKeyboard::Shared().StartRecording(promise); });
  }

  REACT_METHOD(cancelRecording)
  void cancelRecording(DonePromise promise) noexcept {
    RunOnUI(m_context, [promise]() noexcept {
      Menus::MenuKeyboard::Shared().FinishRecording(JSValue{nullptr});
      promise.Resolve();
    });
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
};

}
