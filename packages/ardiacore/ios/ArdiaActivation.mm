#import "ArdiaInternal.h"
#import "ArdiaLaunchConfig.h"

#include <execinfo.h>
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>

#import <objc/message.h>
#import <objc/runtime.h>

#include <initializer_list>
#include <vector>

namespace ardia_host {

namespace {

NSString *LogPath() {
  return [ArdiaLaunchConfig.shared.dataDirectory stringByAppendingPathComponent:@"activation.log"];
}

void Log(NSString *what, NSArray<NSString *> *stack) {
  NSString *path = LogPath();
  if (!path) return;
  NSMutableString *line = [NSMutableString stringWithFormat:@"%@ %@\n", NSDate.date, what];
  for (NSString *frame in [stack subarrayWithRange:NSMakeRange(0, MIN(stack.count, (NSUInteger)40))])
    [line appendFormat:@"    %@\n", frame];
  NSFileHandle *file = [NSFileHandle fileHandleForWritingAtPath:path];
  if (!file) {
    [NSFileManager.defaultManager createFileAtPath:path contents:nil attributes:nil];
    file = [NSFileHandle fileHandleForWritingAtPath:path];
  }
  [file seekToEndOfFile];
  [file writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
  [file closeFile];
}

void LogLater(NSString *what, NSArray<NSNumber *> *addresses) {
  static dispatch_queue_t queue = dispatch_queue_create("ardia.activation-log", DISPATCH_QUEUE_SERIAL);
  dispatch_async(queue, ^{
    std::vector<void *> frames;
    for (NSNumber *address in addresses) frames.push_back((void *)address.unsignedLongValue);
    char **symbols = backtrace_symbols(frames.data(), (int)frames.size());
    NSMutableArray<NSString *> *stack = [NSMutableArray array];
    for (size_t i = 0; symbols && i < frames.size(); i++) [stack addObject:@(symbols[i])];
    free(symbols);
    Log(what, stack);
  });
}

bool FromChromium(NSArray<NSString *> *stack) {
  for (NSString *frame in stack)
    if ([frame containsString:@"Chromium Framework"]) return true;
  return false;
}

template <typename Block>
void Swizzle(Class cls, SEL selector, Block block) {
  Method method = class_getInstanceMethod(cls, selector);
  if (!method) return;
  method_setImplementation(method, imp_implementationWithBlock(block));
}

void ObserveActivation() {
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                if (!NSRunningApplication.currentApplication.isActive) return;
                                                Log(@"became active (deactivating)", NSThread.callStackSymbols);
                                                [NSApp deactivate];
                                              }];
}

const void *kPicksKey = &kPicksKey;

NSArray<NSURL *> *TakePicks() {
  NSString *dir = ArdiaLaunchConfig.shared.dataDirectory;
  if (!dir) return nil;
  NSString *path = [dir stringByAppendingPathComponent:@"file-chooser.txt"];
  NSString *text = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
  if (!text) return nil;
  [NSFileManager.defaultManager removeItemAtPath:path error:nil];
  NSMutableArray<NSURL *> *urls = [NSMutableArray array];
  for (NSString *line in [text componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet])
    if (line.length) [urls addObject:[NSURL fileURLWithPath:line]];
  return urls.count ? urls : nil;
}

void ReturnPicks(NSSavePanel *panel, NSArray<NSURL *> *picks) {
  objc_setAssociatedObject(panel, kPicksKey, picks, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  static NSMutableSet<NSValue *> *patched = [NSMutableSet set];
  for (SEL selector : {@selector(URLs), @selector(URL)}) {
    Method method = class_getInstanceMethod(object_getClass(panel), selector);
    if (!method || [patched containsObject:[NSValue valueWithPointer:method]]) continue;
    [patched addObject:[NSValue valueWithPointer:method]];
    auto original = (id (*)(id, SEL))method_getImplementation(method);
    const bool many = selector == @selector(URLs);
    method_setImplementation(method, imp_implementationWithBlock(^id(id self) {
      NSArray<NSURL *> *urls = objc_getAssociatedObject(self, kPicksKey);
      if (urls) return many ? urls : urls.firstObject;
      return original(self, selector);
    }));
  }
}

NSString *DescribePanel(NSSavePanel *panel, NSWindow *parent, NSString *how) {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  const bool open = [panel isKindOfClass:NSOpenPanel.class];
  [parts addObject:[NSString stringWithFormat:@"%@ panel (not shown): %@", open ? @"open" : @"save", how]];
  if (parent)
    [parts addObject:[NSString stringWithFormat:@"parent %@ #%ld \"%@\"%@", parent.className, (long)parent.windowNumber,
                                                parent.title, parent.isVisible ? @"" : @" (hidden)"]];
  if (open) {
    NSOpenPanel *o = (NSOpenPanel *)panel;
    [parts addObject:[NSString stringWithFormat:@"multiple=%d files=%d directories=%d", o.allowsMultipleSelection,
                                                o.canChooseFiles, o.canChooseDirectories]];
  } else {
    [parts addObject:[NSString stringWithFormat:@"name=\"%@\"", panel.nameFieldStringValue]];
  }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  [parts addObject:[NSString stringWithFormat:@"types=%@ others=%d",
                                              panel.allowedFileTypes ? [panel.allowedFileTypes componentsJoinedByString:@","] : @"*",
                                              panel.allowsOtherFileTypes]];
#pragma clang diagnostic pop
  NSMutableArray<NSView *> *views = panel.accessoryView ? [NSMutableArray arrayWithObject:panel.accessoryView] : [NSMutableArray array];
  while (views.count) {
    NSView *v = views.lastObject;
    [views removeLastObject];
    if ([v isKindOfClass:NSPopUpButton.class])
      [parts addObject:[NSString stringWithFormat:@"popup=[%@] selected=%ld", [((NSPopUpButton *)v).itemTitles componentsJoinedByString:@"|"],
                                                  (long)((NSPopUpButton *)v).indexOfSelectedItem]];
    [views addObjectsFromArray:v.subviews];
  }
  if (panel.directoryURL) [parts addObject:[NSString stringWithFormat:@"directory=%@", panel.directoryURL.path]];
  return [parts componentsJoinedByString:@" | "];
}

NSModalResponse AnswerPanel(NSSavePanel *panel, NSWindow *parent, NSString *how) {
  NSArray<NSURL *> *picks = TakePicks();
  NSString *answer = picks ? [NSString stringWithFormat:@"chose %@", [[picks valueForKey:@"path"] componentsJoinedByString:@", "]]
                           : @"cancelled";
  Log([NSString stringWithFormat:@"%@ | %@", DescribePanel(panel, parent, how), answer], @[]);
  if (picks) ReturnPicks(panel, picks);
  return picks ? NSModalResponseOK : NSModalResponseCancel;
}

void InterceptFilePanels() {
  for (Class cls : {NSSavePanel.class, NSOpenPanel.class}) {
    Swizzle(cls, @selector(beginSheetModalForWindow:completionHandler:),
            ^(NSSavePanel *panel, NSWindow *window, void (^handler)(NSModalResponse)) {
              NSModalResponse response = AnswerPanel(panel, window, @"sheet");
              if (handler) dispatch_async(dispatch_get_main_queue(), ^{ handler(response); });
            });
    Swizzle(cls, @selector(beginWithCompletionHandler:), ^(NSSavePanel *panel, void (^handler)(NSModalResponse)) {
      NSModalResponse response = AnswerPanel(panel, nil, [NSString stringWithFormat:@"free-standing, level %ld", (long)panel.level]);
      if (handler) dispatch_async(dispatch_get_main_queue(), ^{ handler(response); });
    });
    Swizzle(cls, @selector(runModal), ^NSModalResponse(NSSavePanel *panel) { return AnswerPanel(panel, nil, @"app-modal"); });
  }
}

NSString *ImageCentreColour(NSImage *image, NSAppearanceName appearance) {
  uint8_t pixels[12 * 12 * 4] = {};
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels, 12, 12, 8, 12 * 4, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  if (!context) return @"?";
  [[NSAppearance appearanceNamed:appearance] performAsCurrentDrawingAppearance:^{
    [NSGraphicsContext saveGraphicsState];
    NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithCGContext:context flipped:NO];
    [image drawInRect:NSMakeRect(0, 0, 12, 12)];
    [NSGraphicsContext restoreGraphicsState];
  }];
  CGContextRelease(context);
  const uint8_t *p = pixels + (6 * 12 + 6) * 4;
  auto unpremultiplied = [&](int i) { return p[3] ? (int)lround(p[i] * 255.0 / p[3]) : 0; };
  return [NSString stringWithFormat:@"#%02X%02X%02X%02X", unpremultiplied(0), unpremultiplied(1), unpremultiplied(2), p[3]];
}

NSString *DescribeMenuItem(NSMenuItem *item) {
  NSMutableString *text = [item.title mutableCopy];
  if (item.state == NSControlStateValueOn) [text appendString:@" ✓"];
  if (!item.image) return text;
  SEL applicable = NSSelectorFromString(@"_applicableImage");
  bool shown = ![item respondsToSelector:applicable] || ((id (*)(id, SEL))objc_msgSend)(item, applicable) != nil;
  [text appendFormat:@" [image %@ %.0fx%.0f light %@ dark %@]", shown ? @"shown" : @"hidden", item.image.size.width, item.image.size.height,
                     ImageCentreColour(item.image, NSAppearanceNameAqua), ImageCentreColour(item.image, NSAppearanceNameDarkAqua)];
  return text;
}

void ReportMenuItems(NSMenu *menu, NSString *path) {
  NSMutableArray<NSString *> *items = [NSMutableArray array];
  for (NSMenuItem *item in menu.itemArray)
    if (!item.isSeparatorItem && item.title.length) [items addObject:DescribeMenuItem(item)];
  Log([NSString stringWithFormat:@"menu items: %@: %@", path, [items componentsJoinedByString:@" | "]], @[]);
  for (NSMenuItem *item in menu.itemArray)
    if (item.submenu.numberOfItems) ReportMenuItems(item.submenu, [NSString stringWithFormat:@"%@ › %@", path, item.title]);
}

void ReportMenu(NSMenu *menu, NSString *kind) {
  NSMutableArray<NSString *> *titles = [NSMutableArray array];
  for (NSMenuItem *item in menu.itemArray)
    if (!item.isSeparatorItem && item.title.length) [titles addObject:item.title];
  Log([NSString stringWithFormat:@"%@ (not shown): %@", kind, [titles componentsJoinedByString:@" | "]], @[]);
  ReportMenuItems(menu, kind);
  id<NSMenuDelegate> delegate = menu.delegate;
  if ([delegate respondsToSelector:@selector(menuWillOpen:)]) [delegate menuWillOpen:menu];
  if ([delegate respondsToSelector:@selector(menuDidClose:)]) [delegate menuDidClose:menu];
}

NSModalResponse AnswerAlert(NSAlert *alert, NSString *how) {
  NSArray<NSButton *> *buttons = alert.buttons;
  NSUInteger pick = 0;
  for (NSUInteger i = 0; i < buttons.count; i++)
    if ([buttons[i].keyEquivalent isEqualToString:@"\e"]) pick = i;
  NSMutableArray<NSString *> *titles = [NSMutableArray array];
  for (NSButton *button in buttons) [titles addObject:button.title];
  NSString *chosen = buttons.count ? buttons[pick].title : @"OK";
  Log([NSString stringWithFormat:@"alert (not shown): %@ | \"%@\" | \"%@\" | buttons %@ | chose %@", how, alert.messageText,
                                 alert.informativeText, [titles componentsJoinedByString:@", "], chosen],
      @[]);
  return NSAlertFirstButtonReturn + (NSModalResponse)pick;
}

void InterceptAlerts() {
  Swizzle(NSAlert.class, @selector(runModal), ^NSModalResponse(NSAlert *alert) { return AnswerAlert(alert, @"app-modal"); });
  Swizzle(NSAlert.class, @selector(beginSheetModalForWindow:completionHandler:),
          ^(NSAlert *alert, NSWindow *, void (^handler)(NSModalResponse)) {
            NSModalResponse response = AnswerAlert(alert, @"sheet");
            if (handler) dispatch_async(dispatch_get_main_queue(), ^{ handler(response); });
          });
}

}

bool Background() {
  return ArdiaLaunchConfig.shared.background;
}

namespace {

bool gAppActive = true;
__weak NSWindow *gKeyWindow;
void (*gAppKitMakeKey)(id, SEL);

void PostKey(NSWindow *window, bool key) {
  if (window)
    [NSNotificationCenter.defaultCenter postNotificationName:key ? NSWindowDidBecomeKeyNotification : NSWindowDidResignKeyNotification
                                                      object:window];
}

void MakeKey(NSWindow *window) {
  gAppKitMakeKey(window, @selector(makeKeyWindow));
  if (window == gKeyWindow || !window.canBecomeKeyWindow) return;
  NSWindow *previous = gKeyWindow;
  gKeyWindow = window;
  if (!gAppActive) return;
  PostKey(previous, false);
  PostKey(window, true);
}

void KeyWindowLeaving(NSWindow *window) {
  if (window != gKeyWindow) return;
  gKeyWindow = nil;
  if (gAppActive) PostKey(window, false);
  for (NSWindow *next in NSApp.orderedWindows)
    if (next != window && next.visible && next.canBecomeKeyWindow) return MakeKey(next);
}

void FakeKeyWindows() {
  gAppKitMakeKey = (void (*)(id, SEL))method_getImplementation(class_getInstanceMethod(NSWindow.class, @selector(makeKeyWindow)));
  Swizzle(NSApplication.class, @selector(isActive), ^BOOL(NSApplication *) { return gAppActive; });
  Swizzle(NSApplication.class, @selector(keyWindow), ^NSWindow *(NSApplication *) { return gAppActive ? gKeyWindow : nil; });
  Swizzle(NSWindow.class, @selector(isKeyWindow), ^BOOL(NSWindow *window) { return gAppActive && window == gKeyWindow; });
  auto orderOut = (void (*)(id, SEL, id))method_getImplementation(class_getInstanceMethod(NSWindow.class, @selector(orderOut:)));
  Swizzle(NSWindow.class, @selector(orderOut:), ^(NSWindow *window, id sender) {
    KeyWindowLeaving(window);
    orderOut(window, @selector(orderOut:), sender);
  });
  auto close = (void (*)(id, SEL))method_getImplementation(class_getInstanceMethod(NSWindow.class, @selector(close)));
  Swizzle(NSWindow.class, @selector(close), ^(NSWindow *window) {
    KeyWindowLeaving(window);
    close(window, @selector(close));
  });
}

constexpr NSWindowLevel kLevelBand = 1000000;
NSWindowLevel (*gAppKitLevel)(id, SEL);
void (*gAppKitSetLevel)(id, SEL, NSWindowLevel);
const void *kAskedLevelKey = &kAskedLevelKey;
bool gSettingLevel = false;

NSWindowLevel Lowered(NSWindowLevel level) {
  return level < 0 ? level : level < kLevelBand ? level - kLevelBand : -1;
}

void KeepLowered(NSWindow *window) {
  if (gAppKitLevel(window, @selector(level)) >= 0) window.level = window.level;
}

void KeepBehindOwnerWindows() {
  gAppKitLevel = (decltype(gAppKitLevel))method_getImplementation(class_getInstanceMethod(NSWindow.class, @selector(level)));
  gAppKitSetLevel = (decltype(gAppKitSetLevel))method_getImplementation(class_getInstanceMethod(NSWindow.class, @selector(setLevel:)));
  Swizzle(NSWindow.class, @selector(setLevel:), ^(NSWindow *window, NSWindowLevel level) {
    const NSWindowLevel real = Lowered(level);
    objc_setAssociatedObject(window, kAskedLevelKey, real != level ? @(level) : nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    const bool setting = gSettingLevel;
    gSettingLevel = true;
    gAppKitSetLevel(window, @selector(setLevel:), real);
    gSettingLevel = setting;
  });
  Swizzle(NSWindow.class, @selector(level), ^NSWindowLevel(NSWindow *window) {
    NSNumber *asked = gSettingLevel ? nil : objc_getAssociatedObject(window, kAskedLevelKey);
    return asked ? asked.integerValue : gAppKitLevel(window, @selector(level));
  });
  {
    SEL selector = @selector(initWithContentRect:styleMask:backing:defer:);
    auto original = (id (*)(id, SEL, NSRect, NSWindowStyleMask, NSBackingStoreType, BOOL))method_getImplementation(
        class_getInstanceMethod(NSWindow.class, selector));
    Swizzle(NSWindow.class, selector, ^id(NSWindow *window, NSRect rect, NSWindowStyleMask style, NSBackingStoreType backing, BOOL defer) {
      if ((window = original(window, selector, rect, style, backing, defer))) KeepLowered(window);
      return window;
    });
  }
  {
    SEL selector = @selector(initWithContentRect:styleMask:backing:defer:screen:);
    auto original = (id (*)(id, SEL, NSRect, NSWindowStyleMask, NSBackingStoreType, BOOL, NSScreen *))method_getImplementation(
        class_getInstanceMethod(NSWindow.class, selector));
    Swizzle(NSWindow.class, selector, ^id(NSWindow *window, NSRect rect, NSWindowStyleMask style, NSBackingStoreType backing, BOOL defer,
                                          NSScreen *screen) {
      if ((window = original(window, selector, rect, style, backing, defer, screen))) KeepLowered(window);
      return window;
    });
  }
  auto order = (void (*)(id, SEL, NSWindowOrderingMode, NSInteger))method_getImplementation(
      class_getInstanceMethod(NSWindow.class, @selector(orderWindow:relativeTo:)));
  Swizzle(NSWindow.class, @selector(orderWindow:relativeTo:), ^(NSWindow *window, NSWindowOrderingMode place, NSInteger other) {
    if (place != NSWindowOut) KeepLowered(window);
    order(window, @selector(orderWindow:relativeTo:), place, other);
  });
}

}

void SetAppActive(bool active) {
  if (!Background() || active == gAppActive) return;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [center postNotificationName:active ? NSApplicationWillBecomeActiveNotification : NSApplicationWillResignActiveNotification object:NSApp];
  gAppActive = active;
  PostKey(gKeyWindow, active);
  [center postNotificationName:active ? NSApplicationDidBecomeActiveNotification : NSApplicationDidResignActiveNotification object:NSApp];
}

bool UserEvent() {
  switch (NSApp.currentEvent.type) {
    case NSEventTypeLeftMouseDown:
    case NSEventTypeRightMouseDown:
    case NSEventTypeOtherMouseDown:
    case NSEventTypeKeyDown:
      return true;
    default:
      return false;
  }
}

bool Allow(NSString *what) {
  if (!Background() && (NSApp.isActive || UserEvent())) return true;
  NSArray<NSString *> *stack = NSThread.callStackSymbols;
  if (Background() || FromChromium(stack)) {
    Log([@"blocked " stringByAppendingString:what], stack);
    return false;
  }
  return true;
}

void InstallActivationGuardsEarly() {
  static bool installed = false;
  if (installed) return;
  installed = true;

  Method activate = class_getInstanceMethod(NSRunningApplication.class, @selector(activateWithOptions:));
  auto originalActivate = (BOOL (*)(id, SEL, NSApplicationActivationOptions))method_getImplementation(activate);
  Swizzle(NSRunningApplication.class, @selector(activateWithOptions:), ^BOOL(NSRunningApplication *app, NSApplicationActivationOptions options) {
    if ([app isEqual:NSRunningApplication.currentApplication] && !Allow(@"activateWithOptions:")) return NO;
    return originalActivate(app, @selector(activateWithOptions:), options);
  });

  if (!Background()) return;
  FakeKeyWindows();
  KeepBehindOwnerWindows();
  auto note = [](NSString *name, NSWindow *window) {
    LogLater([NSString stringWithFormat:@"%@ on %@ #%ld \"%@\"%@", name, window.className, (long)window.windowNumber,
                                        window.title, gAppActive ? @"" : @" (app inactive)"],
             NSThread.callStackReturnAddresses);
  };
  auto aboveParent = [](NSWindow *window) {
    NSWindow *parent = window.parentWindow;
    if (!parent) return false;
    [window orderWindow:NSWindowAbove relativeTo:parent.windowNumber];
    return true;
  };
  {
    SEL selector = @selector(makeKeyAndOrderFront:);
    auto original = (void (*)(id, SEL, id))method_getImplementation(class_getInstanceMethod(NSWindow.class, selector));
    Swizzle(NSWindow.class, selector, ^(NSWindow *window, id sender) {
      note(@"makeKeyAndOrderFront:", window);
      if (aboveParent(window)) [window makeKeyWindow];
      else original(window, selector, sender);
    });
  }
  Swizzle(NSWindow.class, @selector(makeKeyWindow), ^(NSWindow *window) {
    note(@"makeKeyWindow", window);
    MakeKey(window);
  });
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  for (SEL selector : {@selector(activateIgnoringOtherApps:), @selector(activate)})
    Swizzle(NSApplication.class, selector, ^(NSApplication *) {
      LogLater([@"blocked " stringByAppendingString:NSStringFromSelector(selector)], NSThread.callStackReturnAddresses);
    });
#pragma clang diagnostic pop
  {
    SEL selector = @selector(orderFrontRegardless);
    auto original = (void (*)(id, SEL))method_getImplementation(class_getInstanceMethod(NSWindow.class, selector));
    Swizzle(NSWindow.class, selector, ^(NSWindow *window) {
      note(@"orderFrontRegardless", window);
      KeepLowered(window);
      if (!aboveParent(window)) original(window, selector);
    });
  }
  Swizzle(NSWindow.class, @selector(toggleFullScreen:), ^(NSWindow *window, id) { ActToggleFullScreen(window); });
  Swizzle(NSApplication.class, @selector(unhide:), ^(NSApplication *app, id sender) {
    Log(@"unhide: (unhiding without activation)", NSThread.callStackSymbols);
    [app unhideWithoutActivation];
  });
  Method policy = class_getInstanceMethod(NSApplication.class, @selector(setActivationPolicy:));
  auto originalPolicy = (BOOL (*)(id, SEL, NSApplicationActivationPolicy))method_getImplementation(policy);
  Swizzle(NSApplication.class, @selector(setActivationPolicy:), ^BOOL(NSApplication *app, NSApplicationActivationPolicy value) {
    if (value != NSApplicationActivationPolicyProhibited) Log(@"blocked setActivationPolicy:", NSThread.callStackSymbols);
    return originalPolicy(app, @selector(setActivationPolicy:), NSApplicationActivationPolicyProhibited);
  });
  ObserveActivation();
  Class menuMeta = object_getClass(NSMenu.class);
  Swizzle(menuMeta, @selector(popUpContextMenu:withEvent:forView:),
          ^(id, NSMenu *menu, NSEvent *, NSView *) { ReportMenu(menu, @"context menu"); });
  Swizzle(menuMeta, @selector(popUpContextMenu:withEvent:forView:withFont:),
          ^(id, NSMenu *menu, NSEvent *, NSView *, NSFont *) { ReportMenu(menu, @"context menu"); });
  Swizzle(NSMenu.class, @selector(popUpMenuPositioningItem:atLocation:inView:), ^BOOL(NSMenu *menu, NSMenuItem *, NSPoint, NSView *) {
    ReportMenu(menu, @"pop-up menu");
    return NO;
  });
  InterceptFilePanels();
  InterceptAlerts();
}

namespace {

char gCrashDir[1024];

void WriteAll(int fd, const char *text) {
  for (size_t left = strlen(text); left > 0;) {
    const ssize_t n = write(fd, text, left);
    if (n <= 0) return;
    text += n;
    left -= (size_t)n;
  }
}

void OnFatalSignal(int sig) {
  char path[1200], number[32];
  int len = snprintf(path, sizeof(path), "%s/crash-%d.txt", gCrashDir, getpid());
  const int fd = len > 0 ? open(path, O_WRONLY | O_CREAT | O_APPEND, 0644) : -1;
  if (fd >= 0) {
    snprintf(number, sizeof(number), "%d", sig);
    WriteAll(fd, "signal ");
    WriteAll(fd, number);
    WriteAll(fd, sig < NSIG ? " (" : "");
    WriteAll(fd, sig < NSIG ? sys_signame[sig] : "");
    WriteAll(fd, sig < NSIG ? ")\n" : "\n");
    void *frames[128];
    backtrace_symbols_fd(frames, backtrace(frames, 128), fd);
    close(fd);
  }
  _exit(128 + sig);
}

}

void InstallTestCrashGuard(NSString *dataDir) {
  if (!dataDir.length) return;
  NSString *dir = [dataDir stringByAppendingPathComponent:@"crashes"];
  [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  strlcpy(gCrashDir, dir.fileSystemRepresentation, sizeof(gCrashDir));
  static char altStack[64 * 1024];
  stack_t ss = {.ss_sp = altStack, .ss_size = sizeof(altStack), .ss_flags = 0};
  sigaltstack(&ss, nullptr);
  struct sigaction action = {};
  action.sa_handler = OnFatalSignal;
  action.sa_flags = SA_ONSTACK | SA_RESETHAND;
  sigemptyset(&action.sa_mask);
  for (int sig : {SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGTRAP, SIGFPE, SIGSYS}) sigaction(sig, &action, nullptr);
}

void LogActivation(NSString *what) {
  Log(what, @[]);
}

void InstallActivationGuardsLate() {
  if (Background()) [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
}

}
