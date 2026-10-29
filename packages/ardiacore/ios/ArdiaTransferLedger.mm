#import "ArdiaTransferLedger.h"

#include <os/lock.h>

@implementation ArdiaTransferLedger {
  os_unfair_lock _lock;
  NSInteger _lastGeneration;
  NSMutableDictionary<NSString *, NSNumber *> *_prepared;
  NSMutableDictionary<NSString *, NSNumber *> *_reloadHolds;
  NSMutableDictionary<NSString *, NSNumber *> *_parked;
}

- (instancetype)init {
  if ((self = [super init])) {
    _lock = OS_UNFAIR_LOCK_INIT;
    _prepared = [NSMutableDictionary dictionary];
    _reloadHolds = [NSMutableDictionary dictionary];
    _parked = [NSMutableDictionary dictionary];
  }
  return self;
}

- (NSInteger)locked:(NSInteger (^)(void))body {
  os_unfair_lock_lock(&_lock);
  const NSInteger result = body();
  os_unfair_lock_unlock(&_lock);
  return result;
}

- (NSInteger)replacePrepared:(NSString *)key {
  const NSInteger generation = ++_lastGeneration;
  NSNumber *previous = _prepared[key];
  if (previous && [_parked[key] isEqual:previous]) _parked[key] = @(generation);
  _prepared[key] = @(generation);
  return generation;
}

- (NSInteger)prepare:(NSString *)key {
  return [self locked:^NSInteger {
    [self->_reloadHolds removeObjectForKey:key];
    return [self replacePrepared:key];
  }];
}

- (NSInteger)holdForReload:(NSString *)key {
  return [self locked:^NSInteger {
    const NSInteger generation = [self replacePrepared:key];
    self->_reloadHolds[key] = @(generation);
    return generation;
  }];
}

- (BOOL)isPrepared:(NSString *)key {
  return [self locked:^NSInteger {
    return self->_prepared[key] != nil;
  }];
}

- (NSInteger)park:(NSString *)key {
  return [self locked:^NSInteger {
    NSNumber *generation = self->_prepared[key];
    if (!generation) return 0;
    self->_parked[key] = generation;
    return generation.integerValue;
  }];
}

- (NSInteger)drop:(NSString *)key {
  return [self locked:^NSInteger {
    const NSInteger generation = self->_prepared[key].integerValue;
    [self->_prepared removeObjectForKey:key];
    [self->_reloadHolds removeObjectForKey:key];
    return generation;
  }];
}

- (void)claim:(NSString *)key {
  [self locked:^NSInteger {
    [self->_prepared removeObjectForKey:key];
    [self->_reloadHolds removeObjectForKey:key];
    [self->_parked removeObjectForKey:key];
    return 0;
  }];
}

- (BOOL)expireReloadHold:(NSString *)key generation:(NSInteger)generation {
  return [self locked:^NSInteger {
    if (self->_reloadHolds[key].integerValue != generation || self->_prepared[key].integerValue != generation) return NO;
    [self->_reloadHolds removeObjectForKey:key];
    [self->_prepared removeObjectForKey:key];
    return YES;
  }];
}

- (BOOL)retireParked:(NSString *)key generation:(NSInteger)generation {
  return [self locked:^NSInteger {
    if (generation == 0 || self->_parked[key].integerValue != generation) return NO;
    [self->_parked removeObjectForKey:key];
    return YES;
  }];
}

- (void)unpark:(NSString *)key {
  [self locked:^NSInteger {
    [self->_parked removeObjectForKey:key];
    return 0;
  }];
}

- (NSInteger)parkedGeneration:(NSString *)key {
  return [self locked:^NSInteger {
    return self->_parked[key].integerValue;
  }];
}

@end
