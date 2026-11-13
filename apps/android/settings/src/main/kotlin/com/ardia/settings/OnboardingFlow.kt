package com.ardia.settings

enum class OnboardingStep {
    Welcome,
    Blocking,
    DefaultBrowser,
    Sync,
    AllSet,
    ;

    val next: OnboardingStep? get() = entries.getOrNull(ordinal + 1)

    val isLast: Boolean get() = next == null
}
