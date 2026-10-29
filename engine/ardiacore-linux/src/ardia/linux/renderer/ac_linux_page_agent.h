#ifndef ARDIA_LINUX_RENDERER_AC_LINUX_PAGE_AGENT_H_
#define ARDIA_LINUX_RENDERER_AC_LINUX_PAGE_AGENT_H_

namespace content {
class RenderFrame;
}

namespace ardia {

void CreateLinuxPageAgent(content::RenderFrame* frame);
void RunLinuxPageAgentAtDocumentStart(content::RenderFrame* frame);

}

#endif
