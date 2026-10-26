// Copyright 2026 Ardia. Apache-2.0.

#include <set>
#include <string>
#include <string_view>

#include "base/no_destructor.h"
#include "base/strings/string_util.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_cli_token_policy_internal.h"

namespace ardia {
namespace cli_token_policy_internal {

namespace {

const std::set<std::string>& AllowedEditingCommands() {
  static const base::NoDestructor<std::set<std::string>> commands({
      "deletebackward",
      "deleteforward",
      "deletetobeginningofline",
      "deletetoendofline",
      "deletewordbackward",
      "deletewordforward",
      "insertbacktab",
      "insertlinebreak",
      "insertnewline",
      "inserttab",
      "movebackward",
      "movedown",
      "moveforward",
      "moveleft",
      "moveright",
      "movetobeginningofdocument",
      "movetobeginningofline",
      "movetoendofdocument",
      "movetoendofline",
      "moveup",
      "movewordbackward",
      "movewordforward",
      "movewordleft",
      "movewordright",
      "movebackwardandmodifyselection",
      "movedownandmodifyselection",
      "moveforwardandmodifyselection",
      "moveleftandmodifyselection",
      "moverightandmodifyselection",
      "movetobeginningofdocumentandmodifyselection",
      "movetobeginningoflineandmodifyselection",
      "movetoendofdocumentandmodifyselection",
      "movetoendoflineandmodifyselection",
      "moveupandmodifyselection",
      "movewordbackwardandmodifyselection",
      "movewordforwardandmodifyselection",
      "movewordleftandmodifyselection",
      "movewordrightandmodifyselection",
      "redo",
      "selectall",
      "undo",
  });
  return *commands;
}

}

const std::set<std::string_view>& AllowedMethods() {
  static const base::NoDestructor<std::set<std::string_view>> methods({
      "Accessibility.disable",
      "Accessibility.enable",
      "Accessibility.getChildAXNodes",
      "Accessibility.getFullAXTree",
      "Accessibility.getPartialAXTree",
      "Accessibility.queryAXTree",
      "Browser.getVersion",
      "DOM.describeNode",
      "DOM.disable",
      "DOM.enable",
      "DOM.focus",
      "DOM.getAttributes",
      "DOM.getBoxModel",
      "DOM.getContentQuads",
      "DOM.getDocument",
      "DOM.getFrameOwner",
      "DOM.getNodeForLocation",
      "DOM.getOuterHTML",
      "DOM.querySelector",
      "DOM.querySelectorAll",
      "DOM.requestChildNodes",
      "DOM.requestNode",
      "DOM.resolveNode",
      "DOM.scrollIntoViewIfNeeded",
      "Input.dispatchKeyEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchTouchEvent",
      "Input.insertText",
      "Network.disable",
      "Network.enable",
      "Network.getCertificate",
      "Network.getRequestPostData",
      "Network.getResponseBody",
      "Network.getSecurityIsolationStatus",
      "Network.searchInResponseBody",
      "Network.streamResourceContent",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.bringToFront",
      "Page.captureScreenshot",
      "Page.close",
      "Page.createIsolatedWorld",
      "Page.disable",
      "Page.enable",
      "Page.getFrameTree",
      "Page.getLayoutMetrics",
      "Page.getNavigationHistory",
      "Page.handleJavaScriptDialog",
      "Page.navigate",
      "Page.printToPDF",
      "Page.reload",
      "Page.removeScriptToEvaluateOnNewDocument",
      "Page.setLifecycleEventsEnabled",
      "Page.stopLoading",
      "Runtime.awaitPromise",
      "Runtime.callFunctionOn",
      "Runtime.disable",
      "Runtime.enable",
      "Runtime.evaluate",
      "Runtime.getProperties",
      "Runtime.releaseObject",
      "Runtime.releaseObjectGroup",
      "Runtime.runIfWaitingForDebugger",
      "Target.activateTarget",
      "Target.attachToTarget",
      "Target.closeTarget",
      "Target.createTarget",
      "Target.detachFromTarget",
      "Target.getTargetInfo",
      "Target.getTargets",
      "Target.setAutoAttach",
      "Target.setDiscoverTargets",
  });
  return *methods;
}

bool NeedsResponse(const std::string& method, const base::DictValue& params) {
  if (method == "Target.getTargets" || method == "Target.getTargetInfo" ||
      method == "Page.createIsolatedWorld") {
    return true;
  }
  if (method == "Runtime.evaluate") {
    return !params.Find("contextId") && !params.Find("uniqueContextId");
  }
  if (method == "DOM.resolveNode") {
    return !params.Find("executionContextId");
  }
  return false;
}

bool EditingCommandsAllowed(const base::Value* commands) {
  if (!commands) {
    return true;
  }
  if (!commands->is_list()) {
    return false;
  }
  for (const base::Value& command : commands->GetList()) {
    if (!command.is_string() || !AllowedEditingCommands().contains(
                                    base::ToLowerASCII(command.GetString()))) {
      return false;
    }
  }
  return true;
}

}
}
