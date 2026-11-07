#include "ardia/linux/ac_linux_page_prompts.h"

#include <utility>

#include "ardia/linux/ac_linux_page_prompts_internal.h"
#include "base/no_destructor.h"
#include "content/public/browser/browser_thread.h"

namespace ardiacore {
namespace linux_page_prompts {
namespace {

LinuxPagePromptsDelegate& Delegate() {
  static base::NoDestructor<LinuxPagePromptsDelegate> delegate;
  return *delegate;
}

}

LinuxPromptTab TabFor(content::WebContents* contents) {
  auto& delegate = Delegate();
  return contents && delegate.tab_for ? delegate.tab_for.Run(contents) : LinuxPromptTab();
}

bool Deliver(int window, std::string_view name, base::DictValue data) {
  auto& delegate = Delegate();
  return window > 0 && delegate.deliver && delegate.deliver.Run(window, name, std::move(data));
}

bool PageEvent(content::WebContents* contents, std::string_view name, base::Value data) {
  auto& delegate = Delegate();
  return contents && delegate.page_event && delegate.page_event.Run(contents, name, std::move(data));
}

}

void StartLinuxPagePrompts(LinuxPagePromptsDelegate delegate) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  linux_page_prompts::Delegate() = std::move(delegate);
  linux_page_prompts::InstallPermissionPrompts();
  linux_page_prompts::InstallPasswordPrompts();
  linux_page_prompts::InstallAutofillPrompts();
  linux_page_prompts::InstallExternalAppPrompts();
}

bool LinuxPagePromptCallHandles(std::string_view name) {
  return name == "permissions.resolve" || name == "permissions.resolveExternalApp";
}

std::string LinuxPagePromptCall(int window, std::string_view name, const base::DictValue& input) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (name == "permissions.resolve") return linux_page_prompts::ResolvePermission(window, input);
  if (name == "permissions.resolveExternalApp") return linux_page_prompts::ResolveExternalApp(window, input);
  return "Unknown prompt call";
}

bool LinuxPagePromptCommandHandles(std::string_view command) {
  return command == "resolvePasswordPrompt" || command == "resolveAutofillPrompt";
}

std::string LinuxPagePromptCommand(content::WebContents* contents, std::string_view command,
                                   const base::ListValue& args) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!contents) return "No such live tab";
  if (command == "resolvePasswordPrompt") return linux_page_prompts::ResolvePasswordPrompt(contents, args);
  if (command == "resolveAutofillPrompt") return linux_page_prompts::ResolveAutofillPrompt(contents, args);
  return "Unknown prompt command";
}

void RedeliverLinuxPermissionPrompts(content::WebContents* contents) {
  linux_page_prompts::RedeliverPermissions(contents);
}

std::vector<std::pair<std::string, base::Value>> LinuxPagePromptSnapshot(content::WebContents* contents) {
  std::vector<std::pair<std::string, base::Value>> events;
  if (!contents) return events;
  if (auto prompt = linux_page_prompts::OpenPasswordPrompt(contents))
    events.emplace_back("passwordPrompt", base::Value(std::move(*prompt)));
  if (auto prompt = linux_page_prompts::OpenAutofillPrompt(contents))
    events.emplace_back("autofillPrompt", base::Value(std::move(*prompt)));
  if (auto request = linux_page_prompts::OpenExternalApp(contents))
    events.emplace_back("externalApp", base::Value(std::move(*request)));
  return events;
}

}
