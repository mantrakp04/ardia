#pragma once

#import <AppKit/AppKit.h>

@class ArdiaWebView;

namespace ardia_pip {

void WatchZoom();

void InstallSystemFloatingSubrole();

void VideoEntered(ArdiaWebView *view, NSString *host);

void TabRequestedActivation(ArdiaWebView *view);

}
