package com.ardia.phone

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LookModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneLook")

        View(DeckBackdropView::class) {
            Name("DeckBackdrop")
            Prop("color") { view: DeckBackdropView, value: String? -> view.color = value }
            Prop("themeColors") { view: DeckBackdropView, value: List<String>? -> view.themeColors = value }
            Prop("darkThemeColors") { view: DeckBackdropView, value: List<String>? -> view.darkThemeColors = value }
            Prop("dark") { view: DeckBackdropView, value: Boolean? -> view.dark = value }
            Prop("reduceMotion") { view: DeckBackdropView, value: Boolean? -> view.reduceMotion = value == true }
            Prop("reduceTransparency") { view: DeckBackdropView, value: Boolean? -> view.reduceTransparency = value == true }
            OnViewDidUpdateProps { view -> view.update() }
        }

        View(ProfileBackdropView::class) {
            Name("ProfileBackdrop")
            Prop("color") { view: ProfileBackdropView, value: String? -> view.color = value }
            Prop("themeColors") { view: ProfileBackdropView, value: List<String>? -> view.themeColors = value }
            Prop("darkThemeColors") { view: ProfileBackdropView, value: List<String>? -> view.darkThemeColors = value }
            Prop("dark") { view: ProfileBackdropView, value: Boolean? -> view.dark = value }
            Prop("themed") { view: ProfileBackdropView, value: Boolean? -> view.themed = value == true }
            Prop("softened") { view: ProfileBackdropView, value: Boolean? -> view.softened = value == true }
            OnViewDidUpdateProps { view -> view.update() }
        }

        View(FilmGrainView::class) {
            Name("FilmGrain")
            Prop("opacity") { view: FilmGrainView, value: Float? -> view.opacity = value ?: com.ardia.design.ProfileBackdropStyle.LIGHT_GRAIN }
            OnViewDidUpdateProps { view -> view.update() }
        }

        View(FrostSourceView::class) {
            Name("FrostSource")
            Prop("name") { view: FrostSourceView, value: String? -> view.sourceId = value }
        }

        View(FrostView::class) {
            Name("Frost")
            Prop("source") { view: FrostView, value: String? -> view.source = value }
            Prop("variant") { view: FrostView, value: String? -> view.variant = value }
            Prop("cornerRadius") { view: FrostView, value: Float? -> view.cornerRadius = value ?: 0f }
            Prop("color") { view: FrostView, value: String? -> view.color = value }
            Prop("themeColors") { view: FrostView, value: List<String>? -> view.themeColors = value }
            Prop("darkThemeColors") { view: FrostView, value: List<String>? -> view.darkThemeColors = value }
            Prop("dark") { view: FrostView, value: Boolean? -> view.dark = value }
            Prop("reduceTransparency") { view: FrostView, value: Boolean? -> view.reduceTransparency = value == true }
            OnViewDidUpdateProps { view -> view.update() }
        }
    }
}
