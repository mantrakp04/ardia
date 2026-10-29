#include "ardia/core/ac_page_script.h"

#include "base/no_destructor.h"
#include "content/public/browser/render_process_host.h"
#include "ipc/ipc_channel_proxy.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "ardia/core/mojom/ardiacore.mojom.h"

namespace ardiacore {

namespace {

std::string& Script() {
  static base::NoDestructor<std::string> script;
  return *script;
}

}

void SetPageScript(const std::string& script) {
  Script() = script;
  for (auto it = content::RenderProcessHost::AllHostsIterator(); !it.IsAtEnd();
       it.Advance()) {
    content::RenderProcessHost* host = it.GetCurrentValue();
    if (host->IsInitializedAndNotDead()) {
      SendPageScript(host);
    }
  }
}

const std::string& GetPageScript() {
  return Script();
}

void SendPageScript(content::RenderProcessHost* host) {
  IPC::ChannelProxy* channel = host->GetChannel();
  if (!channel) {
    return;
  }
  mojo::AssociatedRemote<mojom::ACRendererConfig> config;
  channel->GetRemoteAssociatedInterface(&config);
  config->SetPageScript(Script());
}

}
