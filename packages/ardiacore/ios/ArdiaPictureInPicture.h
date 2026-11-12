#pragma once

#import <AppKit/AppKit.h>

@class ArdiaWebView;

namespace ardia_pip {

void WatchZoom();

void VideoEntered(ArdiaWebView *view, NSString *host);

void DocumentEntered(ArdiaWebView *view);

void TabRequestedActivation(ArdiaWebView *view);

}
