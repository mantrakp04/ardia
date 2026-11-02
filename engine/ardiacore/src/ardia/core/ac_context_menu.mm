#include "ardia/core/ac_context_menu.h"

#import <AppKit/AppKit.h>
#include <os/log.h>

#include <optional>
#include <string>
#include <vector>

#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/sys_string_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/renderer_context_menu/render_view_context_menu.h"
#include "chrome/browser/ui/cocoa/renderer_context_menu/render_view_context_menu_mac_cocoa.h"
#include "chrome/browser/ui/tab_contents/chrome_web_contents_menu_helper.h"
#include "chrome/browser/ui/tab_contents/chrome_web_contents_view_delegate.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/browser_context.h"
#include "ui/base/clipboard/clipboard.h"
#include "ui/base/clipboard/clipboard_format_type.h"
#include "ui/base/data_transfer_policy/data_transfer_endpoint.h"
#include "chrome/browser/ui/views/tab_contents/chrome_web_contents_view_delegate_views_mac.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/grit/generated_resources.h"
#include "content/public/browser/context_menu_params.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/drop_data.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_extension_drop.h"
#include "ardia/core/ac_launch_switches.h"
#import "ardia/core/ac_page_view.h"
#import "ardia/core/ardiacore_internal.h"
#include "ui/events/event_constants.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"

namespace ardiacore {

namespace {

constexpr int kHostFirst = IDC_CONTENT_CONTEXT_CUSTOM_FIRST + 900;
constexpr int kHostLast = IDC_CONTENT_CONTEXT_CUSTOM_FIRST + 999;
constexpr int kOpenLinkInProfileItems = 100;

ArdiaCoreTab* TabOf(content::WebContents* contents) {
  return WindowHost::ForContents(contents) ? TabBridge::GetOrCreate(contents)->tab() : nil;
}

NSArray* DescribeMenu(ui::MenuModel* model) {
  NSMutableArray* items = [NSMutableArray array];
  for (size_t i = 0; model && i < model->GetItemCount(); ++i) {
    const ui::MenuModel::ItemType type = model->GetTypeAt(i);
    NSMutableDictionary* item = [@{
      @"id" : @(model->GetCommandIdAt(i)),
      @"label" : base::SysUTF16ToNSString(model->GetLabelAt(i)),
      @"enabled" : @(model->IsEnabledAt(i)),
      @"visible" : @(model->IsVisibleAt(i)),
      @"separator" : @(type == ui::MenuModel::TYPE_SEPARATOR),
      @"type" : @(static_cast<int>(type)),
    } mutableCopy];
    if (type == ui::MenuModel::TYPE_SUBMENU ||
        type == ui::MenuModel::TYPE_ACTIONABLE_SUBMENU) {
      item[@"submenu"] = DescribeMenu(model->GetSubmenuModelAt(i));
    }
    [items addObject:item];
  }
  return items;
}

bool FindPicked(ui::MenuModel* model,
                NSArray* path,
                int command,
                ui::MenuModel** owner,
                size_t* index) {
  if (path) {
    for (NSUInteger depth = 0; model && depth < path.count; ++depth) {
      NSNumber* step = [path[depth] isKindOfClass:NSNumber.class] ? path[depth] : nil;
      if (!step || step.longLongValue < 0 ||
          static_cast<size_t>(step.longLongValue) >= model->GetItemCount()) {
        return false;
      }
      const size_t i = static_cast<size_t>(step.longLongValue);
      if (depth + 1 == path.count) {
        if (model->GetCommandIdAt(i) != command) {
          return false;
        }
        *owner = model;
        *index = i;
        return true;
      }
      model = model->GetSubmenuModelAt(i);
    }
    return false;
  }
  for (size_t i = 0; model && i < model->GetItemCount(); ++i) {
    if (model->GetCommandIdAt(i) == command) {
      *owner = model;
      *index = i;
      return true;
    }
    if (FindPicked(model->GetSubmenuModelAt(i), nil, command, owner, index)) {
      return true;
    }
  }
  return false;
}

class ACContextMenu : public RenderViewContextMenuMacCocoa {
 public:
  using RenderViewContextMenuMacCocoa::RenderViewContextMenuMacCocoa;

  void Show() override {
    if (!ShowThroughHost()) {
      RenderViewContextMenuMacCocoa::Show();
    }
  }

  void ArrangeLikeDia() {
    for (size_t i = menu_model_.GetItemCount(); i-- > 0;) {
      const int command = menu_model_.GetCommandIdAt(i);
      if (command == IDC_CONTENT_CONTEXT_OPENLINKINPROFILE ||
          (command >= IDC_OPEN_LINK_IN_PROFILE_FIRST &&
           command < IDC_OPEN_LINK_IN_PROFILE_FIRST + kOpenLinkInProfileItems)) {
        menu_model_.RemoveItemAt(i);
      }
    }
    const std::optional<size_t> save =
        menu_model_.GetIndexOfCommandId(IDC_CONTENT_CONTEXT_SAVELINKAS);
    const std::optional<size_t> copy =
        menu_model_.GetIndexOfCommandId(IDC_CONTENT_CONTEXT_COPYLINKLOCATION);
    if (save && copy && *save > *copy) {
      menu_model_.RemoveItemAt(*save);
      menu_model_.InsertItemWithStringIdAt(*copy, IDC_CONTENT_CONTEXT_SAVELINKAS,
                                           IDS_CONTENT_CONTEXT_SAVELINKAS);
    }
    const std::optional<size_t> reload = menu_model_.GetIndexOfCommandId(IDC_RELOAD);
    if (!reload) {
      return;
    }
    if (!menu_model_.GetIndexOfCommandId(IDC_BACK)) {
      menu_model_.InsertItemWithStringIdAt(
          menu_model_.GetIndexOfCommandId(IDC_FORWARD).value_or(*reload), IDC_BACK,
          IDS_CONTENT_CONTEXT_BACK);
    }
    if (!menu_model_.GetIndexOfCommandId(IDC_FORWARD)) {
      menu_model_.InsertItemWithStringIdAt(*menu_model_.GetIndexOfCommandId(IDC_BACK) + 1,
                                           IDC_FORWARD, IDS_CONTENT_CONTEXT_FORWARD);
    }
  }

  void RemoveViewlessItems() {
    for (int command : {IDC_CONTENT_CONTEXT_OPEN_IN_READING_MODE,
                        IDC_CONTENT_CONTEXT_LISTEN_TO_THIS_PAGE,
                        IDC_CONTENT_CONTEXT_GENERATE_QR_CODE, IDC_SEND_TAB_TO_SELF,
                        IDC_CONTENT_CONTEXT_SEARCHLENSFORIMAGE,
                        IDC_CONTENT_CONTEXT_SEARCHLENSFORVIDEOFRAME,
                        IDC_CONTENT_CONTEXT_LENS_REGION_SEARCH}) {
      while (std::optional<size_t> index = menu_model_.GetIndexOfCommandId(command)) {
        menu_model_.RemoveItemAt(*index);
      }
    }
    const auto separator = [this](size_t i) {
      return menu_model_.GetTypeAt(i) == ui::MenuModel::TYPE_SEPARATOR;
    };
    for (size_t i = menu_model_.GetItemCount(); i-- > 0;) {
      const size_t count = menu_model_.GetItemCount();
      if (i < count && separator(i) &&
          (i == 0 || i + 1 == count || separator(i + 1))) {
        menu_model_.RemoveItemAt(i);
      }
    }
  }

  void AddHostItems() {
    const std::u16string& selection = params().selection_text;
    ArdiaCoreTab* tab = TabOf(source_web_contents_);
    id<ArdiaCoreTabDelegate> delegate = tab.delegate;
    if (selection.empty() || params().is_editable ||
        ![delegate respondsToSelector:@selector(tab:contextMenuItemsForSelection:)]) {
      return;
    }
    NSArray<NSDictionary*>* items =
        [delegate tab:tab
            contextMenuItemsForSelection:base::SysUTF16ToNSString(selection)];
    std::optional<size_t> copy =
        menu_model_.GetIndexOfCommandId(IDC_CONTENT_CONTEXT_COPY);
    size_t at = copy ? *copy + 1 : menu_model_.GetItemCount();
    for (NSDictionary* item in items) {
      NSString* item_id = [item[@"id"] isKindOfClass:NSString.class] ? item[@"id"] : nil;
      NSString* title = [item[@"title"] isKindOfClass:NSString.class] ? item[@"title"] : nil;
      const int command = kHostFirst + static_cast<int>(host_items_.size());
      if (!item_id || !title || command > kHostLast) {
        continue;
      }
      host_items_.push_back(base::SysNSStringToUTF8(item_id));
      size_t place = at;
      bool replaced = false;
      if ([item[@"replaces"] isEqual:@"search"]) {
        for (int chrome_id : {IDC_CONTENT_CONTEXT_SEARCHWEBFOR,
                              IDC_CONTENT_CONTEXT_SEARCHWEBFORNEWTAB}) {
          if (std::optional<size_t> index = menu_model_.GetIndexOfCommandId(chrome_id)) {
            if (!replaced) {
              place = *index;
            }
            menu_model_.RemoveItemAt(*index);
            replaced = true;
            if (*index < at) {
              --at;
            }
          }
        }
      }
      menu_model_.InsertItemAt(place, command, base::SysNSStringToUTF16(title));
      if (!replaced || place < at) {
        ++at;
      }
    }
  }

 protected:
  bool IsCommandIdEnabled(int command_id) const override {
    if (command_id >= kHostFirst && command_id <= kHostLast) {
      return true;
    }
    return RenderViewContextMenuMacCocoa::IsCommandIdEnabled(command_id);
  }

  void ExecuteCommand(int command_id, int event_flags) override {
    if (command_id == IDC_CONTENT_CONTEXT_OPENLINKSPLITVIEW && TabOf(source_web_contents_)) {
      OpenURLWithExtraHeaders(params_.link_url, params_.frame_url, params_.frame_origin,
                              WindowOpenDisposition::NEW_SPLIT_VIEW, ui::PAGE_TRANSITION_LINK,
                              std::string(), true, base::DoNothing());
      return;
    }
    const size_t index = command_id - kHostFirst;
    if (command_id < kHostFirst || command_id > kHostLast ||
        index >= host_items_.size()) {
      RenderViewContextMenuMacCocoa::ExecuteCommand(command_id, event_flags);
      return;
    }
    ArdiaCoreTab* tab = TabOf(source_web_contents_);
    id<ArdiaCoreTabDelegate> delegate = tab.delegate;
    if ([delegate respondsToSelector:@selector(tab:contextMenuCommand:text:modifiers:)]) {
      [delegate tab:tab
          contextMenuCommand:base::SysUTF8ToNSString(host_items_[index])
                        text:base::SysUTF16ToNSString(params().selection_text)
                   modifiers:@{
                     @"metaKey" : @((event_flags & ui::EF_COMMAND_DOWN) != 0),
                     @"shiftKey" : @((event_flags & ui::EF_SHIFT_DOWN) != 0),
                     @"altKey" : @((event_flags & ui::EF_ALT_DOWN) != 0),
                   }];
    }
  }

 private:
  bool ShowThroughHost() {
    static const bool to_host = BackgroundInstance() || TestFlag("contextMenu");
    if (!to_host) {
      return false;
    }
    ArdiaCoreTab* tab = TabOf(GetWebContents());
    id<ArdiaCoreTabDelegate> delegate = tab.delegate;
    const bool runs = [delegate respondsToSelector:@selector(tab:runContextMenu:)];
    if (!runs && ![delegate respondsToSelector:@selector(tab:didShowContextMenu:)]) {
      return false;
    }
    base::WeakPtr<ACContextMenu> weak = weak_factory_.GetWeakPtr();
    ui::SimpleMenuModel* model = &menu_model_;
    NSNumber* command = nil;
    NSNumber* flags = nil;
    NSArray* path = nil;
    if (runs) {
      NSDictionary* picked = [delegate tab:tab
                            runContextMenu:@{
                              @"items" : DescribeMenu(model),
                              @"url" : base::SysUTF8ToNSString(params().page_url.spec()),
                              @"link" : base::SysUTF8ToNSString(params().link_url.spec()),
                            }];
      command = [picked[@"command"] isKindOfClass:NSNumber.class] ? picked[@"command"] : nil;
      flags = [picked[@"flags"] isKindOfClass:NSNumber.class] ? picked[@"flags"] : nil;
      path = [picked[@"path"] isKindOfClass:NSArray.class] ? picked[@"path"] : nil;
    } else {
      [delegate tab:tab didShowContextMenu:DescribeMenu(model)];
    }
    if (!weak) {
      return true;
    }
    ui::MenuModel* owner = nullptr;
    size_t index = 0;
    const bool found = command && FindPicked(model, path, command.intValue, &owner, &index);
    if (command && TestFlag("contextMenu")) {
      const std::string where =
          !found            ? "not found"
          : owner == model ? "top level"
                           : "submenu [" + base::UTF16ToUTF8(owner->GetLabelAt(0)) + ", …]";
      os_log(OS_LOG_DEFAULT, "[ardiacore-menu] pick %d: %{public}s", command.intValue,
             where.c_str());
    }
    MenuClosed(model);
    if (weak && found && owner->IsEnabledAt(index)) {
      owner->ActivatedAt(index, flags.intValue);
    }
    return true;
  }

  std::vector<std::string> host_items_;
  base::WeakPtrFactory<ACContextMenu> weak_factory_{this};
};

class ACViewDelegate : public ChromeWebContentsViewDelegateViewsMac {
 public:
  explicit ACViewDelegate(content::WebContents* contents)
      : ChromeWebContentsViewDelegateViewsMac(contents), contents_(contents) {}

  NSObject<RenderWidgetHostViewMacDelegate>* GetDelegateForHost(
      content::RenderWidgetHost* render_widget_host,
      bool is_popup) override {
    return is_popup ? nil : CreatePageViewDelegate(render_widget_host);
  }

  std::unique_ptr<RenderViewContextMenuBase> BuildMenu(
      content::RenderFrameHost& render_frame_host,
      const content::ContextMenuParams& params) override {
    content::RenderWidgetHostView* view = contents_->GetRenderWidgetHostView();
    if (!TabOf(contents_) || !view) {
      return ChromeWebContentsViewDelegateViewsMac::BuildMenu(render_frame_host,
                                                              params);
    }
    auto menu = std::make_unique<ACContextMenu>(
        render_frame_host, params, paste_enabled_, paste_and_match_style_enabled_,
        view->GetNativeView().GetNativeNSView());
    menu->Init();
    menu->ArrangeLikeDia();
    menu->RemoveViewlessItems();
    menu->AddHostItems();
    return menu;
  }

  void OnPerformingDrop(const content::DropData& drop_data,
                        DropCompletionCallback callback) override {
    if (TabOf(contents_) && InstallDroppedExtensions(contents_, drop_data)) {
      std::move(callback).Run(std::nullopt);
      return;
    }
    ChromeWebContentsViewDelegateViewsMac::OnPerformingDrop(drop_data,
                                                            std::move(callback));
  }

  void BuildMenuAsync(
      content::RenderFrameHost& render_frame_host,
      const content::ContextMenuParams& params,
      base::OnceCallback<void(std::unique_ptr<RenderViewContextMenuBase>)> callback)
      override {
    if (!TabOf(contents_)) {
      ChromeWebContentsViewDelegateViewsMac::BuildMenuAsync(render_frame_host, params,
                                                            std::move(callback));
      return;
    }
    tabs::TabInterface* tab_interface = tabs::TabInterface::MaybeGetFromContents(contents_);
    if (tab_interface && !tab_interface->IsActivated()) {
      contents_->Focus();
    }
    std::optional<ui::DataTransferEndpoint> data_dst;
    if (params.page_url.is_valid()) {
      data_dst.emplace(params.page_url,
                       ui::DataTransferEndpointOptions{
                           .notify_if_restricted = false,
                           .off_the_record =
                               contents_->GetBrowserContext()->IsOffTheRecord(),
                       });
    }
    ui::Clipboard::GetForCurrentThread()->ReadAvailableTypes(
        ui::ClipboardBuffer::kCopyPaste, data_dst,
        base::BindOnce(&ACViewDelegate::OnReadAvailableTypes, weak_factory_.GetWeakPtr(),
                       render_frame_host.GetGlobalId(),
                       AddContextMenuParamsPropertiesFromPreferences(contents_, params),
                       data_dst, std::move(callback)));
  }

 private:
  void OnReadAvailableTypes(
      content::GlobalRenderFrameHostId frame_id,
      const content::ContextMenuParams& params,
      std::optional<ui::DataTransferEndpoint> data_dst,
      base::OnceCallback<void(std::unique_ptr<RenderViewContextMenuBase>)> callback,
      std::vector<std::u16string> types) {
    paste_enabled_ = !types.empty();
    ui::Clipboard::GetForCurrentThread()->GetAllAvailableFormats(
        ui::ClipboardBuffer::kCopyPaste, std::move(data_dst),
        base::BindOnce(&ACViewDelegate::OnGetAllAvailableFormats,
                       weak_factory_.GetWeakPtr(), frame_id, params, std::move(callback)));
  }

  void OnGetAllAvailableFormats(
      content::GlobalRenderFrameHostId frame_id,
      const content::ContextMenuParams& params,
      base::OnceCallback<void(std::unique_ptr<RenderViewContextMenuBase>)> callback,
      base::flat_set<ui::ClipboardFormatType> formats) {
    paste_and_match_style_enabled_ =
        formats.contains(ui::ClipboardFormatType::PlainTextType());
    content::RenderFrameHost* frame = content::RenderFrameHost::FromID(frame_id);
    if (!frame) {
      std::move(callback).Run(nullptr);
      return;
    }
    std::move(callback).Run(BuildMenu(*frame, params));
  }

  raw_ptr<content::WebContents> contents_;
  bool paste_enabled_ = false;
  bool paste_and_match_style_enabled_ = false;
  base::WeakPtrFactory<ACViewDelegate> weak_factory_{this};
};

}

std::unique_ptr<content::WebContentsViewDelegate> CreateViewDelegate(
    content::WebContents* contents) {
  return std::make_unique<ACViewDelegate>(contents);
}

}
