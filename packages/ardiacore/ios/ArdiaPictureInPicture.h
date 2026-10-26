#pragma once

#import <AppKit/AppKit.h>

@class ArdiaWebView;

namespace ardia_pip {

void WatchZoom();

void VideoChanged(ArdiaWebView *view, NSString *host, NSString *frameId, bool active);

void TabRequestedActivation(ArdiaWebView *view);

}
