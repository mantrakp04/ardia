#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <dlfcn.h>

typedef CGImageRef (*CreateImageFromArray)(CGRect, CFArrayRef, uint32_t);

static NSString *gDir;
static NSString *gLastCommand = @"";
static dispatch_queue_t gQueue;
static dispatch_source_t gPoll;
static dispatch_source_t gTick;
static CreateImageFromArray gCapture;
static AVAssetWriter *gWriter;
static AVAssetWriterInput *gInput;
static AVAssetWriterInputPixelBufferAdaptor *gAdaptor;
static CGRect gRect;
static double gStart;
static double gEnd;
static size_t gWidth;
static size_t gHeight;
static long gFrames;
static long gDropped;

static void Status(NSString *line) {
  NSString *path = [gDir stringByAppendingPathComponent:@"status"];
  NSFileHandle *h = [NSFileHandle fileHandleForWritingAtPath:path];
  if (!h) {
    [[NSFileManager defaultManager] createFileAtPath:path contents:nil attributes:nil];
    h = [NSFileHandle fileHandleForWritingAtPath:path];
  }
  [h seekToEndOfFile];
  [h writeData:[[line stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding]];
  [h closeFile];
}

static NSArray<NSDictionary *> *OwnWindows(void) {
  pid_t me = getpid();
  NSArray *all = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID));
  NSMutableArray *mine = [NSMutableArray array];
  for (NSDictionary *w in all) {
    if ([w[(id)kCGWindowOwnerPID] intValue] != me) continue;
    CGRect r;
    if (!CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)w[(id)kCGWindowBounds], &r)) continue;
    if (r.size.width <= 1 || r.size.height <= 1) continue;
    if ([w[(id)kCGWindowAlpha] doubleValue] <= 0) continue;
    [mine addObject:w];
  }
  return mine;
}

static double Now(void) { return [[NSDate date] timeIntervalSince1970]; }

static void Finish(void) {
  if (gTick) {
    dispatch_source_cancel(gTick);
    gTick = nil;
  }
  if (!gWriter) return;
  [gInput markAsFinished];
  AVAssetWriter *writer = gWriter;
  gWriter = nil;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [writer finishWritingWithCompletionHandler:^{ dispatch_semaphore_signal(done); }];
  dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC));
  Status([NSString stringWithFormat:@"frames %ld dropped %ld", gFrames, gDropped]);
  Status(writer.status == AVAssetWriterStatusCompleted ? @"finished" : [NSString stringWithFormat:@"error %@", writer.error]);
}

static void Grab(void) {
  if (!gWriter) return;
  double t = Now();
  if (t > gEnd) {
    Finish();
    return;
  }
  if (!gInput.readyForMoreMediaData) {
    gDropped++;
    return;
  }
  NSArray *windows = OwnWindows();
  if (windows.count == 0) return;
  const void **ids = malloc(sizeof(void *) * windows.count);
  for (NSUInteger i = 0; i < windows.count; i++) ids[i] = (const void *)(uintptr_t)[windows[i][(id)kCGWindowNumber] unsignedIntValue];
  CFArrayRef list = CFArrayCreate(NULL, ids, (CFIndex)windows.count, NULL);
  free(ids);
  CGImageRef image = gCapture(gRect, list, 8);
  CFRelease(list);
  if (!image) {
    gDropped++;
    return;
  }
  CVPixelBufferRef buffer = NULL;
  CVPixelBufferPoolCreatePixelBuffer(NULL, gAdaptor.pixelBufferPool, &buffer);
  if (!buffer) {
    CGImageRelease(image);
    gDropped++;
    return;
  }
  CVPixelBufferLockBaseAddress(buffer, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef ctx = CGBitmapContextCreate(CVPixelBufferGetBaseAddress(buffer), gWidth, gHeight, 8, CVPixelBufferGetBytesPerRow(buffer), space, kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
  CGContextSetRGBFillColor(ctx, 0, 0, 0, 1);
  CGContextFillRect(ctx, CGRectMake(0, 0, gWidth, gHeight));
  CGContextDrawImage(ctx, CGRectMake(0, 0, gWidth, gHeight), image);
  CGContextRelease(ctx);
  CGColorSpaceRelease(space);
  CVPixelBufferUnlockBaseAddress(buffer, 0);
  CGImageRelease(image);
  if (gFrames == 0) {
    gStart = t;
    [gWriter startSessionAtSourceTime:kCMTimeZero];
    Status([NSString stringWithFormat:@"recording %lld", (long long)llround(t * 1000)]);
  }
  CMTime at = CMTimeMakeWithSeconds(t - gStart, 600);
  if ([gAdaptor appendPixelBuffer:buffer withPresentationTime:at]) gFrames++;
  else gDropped++;
  CVPixelBufferRelease(buffer);
}

static void Start(NSString *out, int fps, double seconds) {
  Finish();
  NSArray *windows = OwnWindows();
  NSDictionary *largest = nil;
  double area = 0;
  for (NSDictionary *w in windows) {
    CGRect r;
    CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)w[(id)kCGWindowBounds], &r);
    if (r.size.width * r.size.height > area) {
      area = r.size.width * r.size.height;
      largest = w;
    }
  }
  if (!largest) {
    Status(@"error no window");
    return;
  }
  CGRectMakeWithDictionaryRepresentation((CFDictionaryRef)largest[(id)kCGWindowBounds], &gRect);
  gRect = CGRectIntegral(gRect);
  __block CGFloat scale = 2;
  dispatch_sync(dispatch_get_main_queue(), ^{
    for (NSWindow *w in NSApp.windows) {
      if (w.windowNumber == [largest[(id)kCGWindowNumber] integerValue]) scale = w.backingScaleFactor;
    }
  });
  gWidth = ((size_t)(gRect.size.width * scale)) & ~1;
  gHeight = ((size_t)(gRect.size.height * scale)) & ~1;
  [[NSFileManager defaultManager] removeItemAtPath:out error:nil];
  NSError *error = nil;
  gWriter = [AVAssetWriter assetWriterWithURL:[NSURL fileURLWithPath:out] fileType:AVFileTypeQuickTimeMovie error:&error];
  if (!gWriter) {
    Status([NSString stringWithFormat:@"error %@", error]);
    return;
  }
  NSDictionary *settings = @{
    AVVideoCodecKey : AVVideoCodecTypeH264,
    AVVideoWidthKey : @(gWidth),
    AVVideoHeightKey : @(gHeight),
    AVVideoCompressionPropertiesKey : @{AVVideoAverageBitRateKey : @(40000000), AVVideoExpectedSourceFrameRateKey : @(fps)},
  };
  gInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:settings];
  gInput.expectsMediaDataInRealTime = YES;
  gAdaptor = [AVAssetWriterInputPixelBufferAdaptor assetWriterInputPixelBufferAdaptorWithAssetWriterInput:gInput sourcePixelBufferAttributes:@{
    (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (id)kCVPixelBufferWidthKey : @(gWidth),
    (id)kCVPixelBufferHeightKey : @(gHeight),
  }];
  [gWriter addInput:gInput];
  [gWriter startWriting];
  gFrames = 0;
  gDropped = 0;
  gEnd = Now() + seconds;
  Status([NSString stringWithFormat:@"rect %d,%d,%d,%d scale %g size %zux%zu", (int)gRect.origin.x, (int)gRect.origin.y, (int)gRect.size.width, (int)gRect.size.height, scale, gWidth, gHeight]);
  gTick = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, gQueue);
  dispatch_source_set_timer(gTick, DISPATCH_TIME_NOW, NSEC_PER_SEC / fps, NSEC_PER_MSEC);
  dispatch_source_set_event_handler(gTick, ^{ Grab(); });
  dispatch_resume(gTick);
}

static void Poll(void) {
  NSString *command = [NSString stringWithContentsOfFile:[gDir stringByAppendingPathComponent:@"cmd"] encoding:NSUTF8StringEncoding error:nil];
  if (!command || [command isEqualToString:gLastCommand]) return;
  gLastCommand = command;
  NSArray *parts = [[command stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] componentsSeparatedByString:@"\t"];
  if ([parts[0] isEqualToString:@"start"] && parts.count >= 5) Start(parts[2], [parts[3] intValue], [parts[4] doubleValue]);
  else if ([parts[0] isEqualToString:@"stop"]) Finish();
}

__attribute__((constructor)) static void SelfRecInit(void) {
  const char *dir = getenv("FIXES_SELFREC_DIR");
  if (!dir) return;
  if (![[NSBundle mainBundle].bundlePath.lastPathComponent isEqualToString:@"Ardia.app"]) return;
  gCapture = (CreateImageFromArray)dlsym(RTLD_DEFAULT, "CGWindowListCreateImageFromArray");
  if (!gCapture) return;
  gDir = [NSString stringWithUTF8String:dir];
  [[NSFileManager defaultManager] createDirectoryAtPath:gDir withIntermediateDirectories:YES attributes:nil error:nil];
  gQueue = dispatch_queue_create("selfrec", DISPATCH_QUEUE_SERIAL);
  gPoll = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, gQueue);
  dispatch_source_set_timer(gPoll, DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC, 10 * NSEC_PER_MSEC);
  dispatch_source_set_event_handler(gPoll, ^{ Poll(); });
  dispatch_resume(gPoll);
}
