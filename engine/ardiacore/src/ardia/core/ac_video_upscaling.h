// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_AC_VIDEO_UPSCALING_H_
#define ARDIA_CORE_AC_VIDEO_UPSCALING_H_

#include <optional>

@class NSDictionary;

namespace ardiacore {

void StartVideoUpscaling();

void SetVideoUpscalingEnabled(bool enabled);

void SetVideoUpscalingTestConditions(std::optional<bool> low_power,
                                     std::optional<bool> thermal_pressure,
                                     std::optional<bool> capturing);

void VideoUpscalingInputsChanged();

NSDictionary* VideoUpscalingState();

}

#endif
