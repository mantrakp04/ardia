#import "ArdiaNowPlaying.h"

#include <cmath>

namespace {

template <typename T>
T *Field(NSDictionary *d, NSString *key) {
  id value = d[key];
  return [value isKindOfClass:[T class]] ? value : nil;
}

NSString *Text(NSDictionary *d, NSString *key, NSUInteger max) {
  NSString *s = Field<NSString>(d, key);
  if (s.length <= max) return s;
  return [s substringToIndex:[s rangeOfComposedCharacterSequenceAtIndex:max].location];
}

bool Finite(NSDictionary *d, NSString *key, double *out) {
  NSNumber *n = Field<NSNumber>(d, key);
  if (!n || !std::isfinite(n.doubleValue)) return false;
  *out = n.doubleValue;
  return true;
}

NSDictionary *Sanitized(NSDictionary *d, BOOL main) {
  NSString *state = Field<NSString>(d, @"playbackState");
  if (![@[ @"none", @"paused", @"playing" ] containsObject:state]) state = @"none";
  NSMutableArray *actions = [NSMutableArray array];
  for (id action in Field<NSArray>(d, @"actions"))
    if ([action isKindOfClass:NSString.class] && [action length] <= 64 && actions.count < 32) [actions addObject:action];
  double position = 0, duration = 0, rate = 1, timestamp = 0;
  Finite(d, @"position", &position);
  const bool hasDuration = Finite(d, @"duration", &duration) && duration >= 0;
  Finite(d, @"playbackRate", &rate);
  Finite(d, @"timestamp", &timestamp);
  return @{
    @"title" : Text(d, @"title", 1024) ?: @"",
    @"artist" : Text(d, @"artist", 1024) ?: @"",
    @"album" : Text(d, @"album", 1024) ?: @"",
    @"artwork" : Text(d, @"artwork", 1 << 20) ?: NSNull.null,
    @"playbackState" : state,
    @"position" : @(MAX(position, 0)),
    @"duration" : hasDuration ? @(duration) : NSNull.null,
    @"playbackRate" : @(rate),
    @"timestamp" : @(timestamp),
    @"hasVideo" : @([Field<NSNumber>(d, @"hasVideo") boolValue]),
    @"actions" : actions,
    @"controllable" : @([Field<NSNumber>(d, @"controllable") boolValue]),
  };
}

}

@implementation ArdiaNowPlaying {
  NSMutableDictionary<NSString *, NSDictionary *> *_frames;
  NSMutableSet<NSString *> *_mainFrames;
}

- (instancetype)init {
  if ((self = [super init])) {
    _frames = [NSMutableDictionary dictionary];
    _mainFrames = [NSMutableSet set];
  }
  return self;
}

- (BOOL)isEmpty {
  return _frames.count == 0;
}

- (NSDictionary *)selected {
  return _frame ? _frames[_frame] : nil;
}

- (NSInteger)rank:(NSString *)frame {
  NSDictionary *state = frame ? _frames[frame] : nil;
  if (!state) return -1;
  return ([state[@"controllable"] boolValue] ? 4 : 0) + ([state[@"playbackState"] isEqual:@"playing"] ? 2 : 0) +
         ([_mainFrames containsObject:frame] ? 1 : 0);
}

- (NSDictionary *)noteFrame:(NSString *)frame page:(id)page main:(BOOL)main {
  NSDictionary *dict = [page isKindOfClass:NSDictionary.class] && [page count] ? page : nil;
  if (dict) {
    _frames[frame] = Sanitized(dict, main);
    if (main) [_mainFrames addObject:frame];
    else [_mainFrames removeObject:frame];
  } else {
    [_frames removeObjectForKey:frame];
    [_mainFrames removeObject:frame];
  }
  _frame = dict ? frame : _frames.allKeys.firstObject;
  for (NSString *other in _frames)
    if ([self rank:other] > [self rank:_frame]) _frame = other;
  return self.selected;
}

- (BOOL)reset {
  const BOOL had = _frames.count > 0;
  [_frames removeAllObjects];
  [_mainFrames removeAllObjects];
  _frame = nil;
  return had;
}

@end
