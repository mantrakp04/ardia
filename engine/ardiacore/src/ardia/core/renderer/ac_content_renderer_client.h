#ifndef ARDIA_CORE_RENDERER_AC_CONTENT_RENDERER_CLIENT_H_
#define ARDIA_CORE_RENDERER_AC_CONTENT_RENDERER_CLIENT_H_

#include <memory>

#include "chrome/renderer/chrome_content_renderer_client.h"

namespace ardiacore {

class ACRenderThreadObserver;

class ACContentRendererClient : public ChromeContentRendererClient {
 public:
  ACContentRendererClient();
  ~ACContentRendererClient() override;

  void RenderThreadStarted() override;
  void RenderFrameCreated(content::RenderFrame* render_frame) override;
  void RunScriptsAtDocumentStart(content::RenderFrame* render_frame) override;
  void RunScriptsAtDocumentEnd(content::RenderFrame* render_frame) override;

 private:
  std::unique_ptr<ACRenderThreadObserver> observer_;
};

}

#endif
