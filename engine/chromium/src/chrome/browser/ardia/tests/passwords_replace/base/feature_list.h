#pragma once
namespace base {
struct Feature {
  bool enabled = false;
};
struct FeatureList {
  static bool IsEnabled(const Feature& feature) { return feature.enabled; }
};
}
