import Testing

@testable import ArdiaIntelligence

struct PageMarkupTests {
  @Test func `reads the example format into sections, points and follow-ups`() {
    let draft = PageMarkup.sections(
      """
      ## How It Works
      - ❄️ Heat extraction: Heat pumps pull warmth from outdoor air below freezing. [1, 3]
      - 🔁 Refrigerant: A compressor raises its temperature before releasing it indoors. [1]
      ## **Cold Weather**
      - ⚠️ Defrost: Coils ice over, so the unit reverses briefly to melt them. [2]
      Next:
      ? How cold is too cold?
      ? Do I need backup heat?
      """)

    #expect(draft.sections.map(\.heading) == ["How It Works", "Cold Weather"])
    let first = draft.sections[0].bullets[0]
    #expect(first.emoji == "❄️")
    #expect(first.lead == "Heat extraction")
    #expect(first.text == "Heat pumps pull warmth from outdoor air below freezing.")
    #expect(first.sources == [1, 3])
    #expect(draft.sections[1].bullets.map(\.sources) == [[2]])
    #expect(draft.followUps == ["How cold is too cold?", "Do I need backup heat?"])
  }

  @Test func `points without a lead, bold markers and wrapped lines still read cleanly`() {
    let draft = PageMarkup.sections(
      """
      **Overview**
      - Heat pumps move heat instead of making it, which is why they are efficient [1]
        even when it is cold outside.
      1. 💡 **Tip**: Clear snow from around the outdoor unit. [2]
      """)

    #expect(draft.sections.map(\.heading) == ["Overview"])
    let bullets = draft.sections[0].bullets
    #expect(bullets[0].lead?.isEmpty == true)
    #expect(bullets[0].sources == [1])
    #expect(bullets[0].text?.hasSuffix("even when it is cold outside.") == true)
    #expect(bullets[1].emoji == "💡")
    #expect(bullets[1].lead == "Tip")
    #expect(bullets[1].text == "Clear snow from around the outdoor unit.")
  }

  @Test func `a half streamed reply shows what is complete so far`() {
    let draft = PageMarkup.sections("## How It Works\n- ❄️ Heat extraction: Heat pumps pull warm")

    #expect(draft.sections.count == 1)
    #expect(draft.sections[0].bullets.first?.text == "Heat pumps pull warm")
  }

  @Test func `the overview reads its title and answer, even across lines`() {
    let draft = PageMarkup.overview("**Title:** Heat Pumps in Winter\nAnswer: They move outdoor heat inside.\nEven below freezing.")

    #expect(draft.title == "Heat Pumps in Winter")
    #expect(draft.answer == "They move outdoor heat inside. Even below freezing.")
    #expect(PageMarkup.overview("Title: Heat Pu").answer == nil)
  }

  @Test func `placeholders, nested citations and follow-ups without a label are cleaned up`() {
    let draft = PageMarkup.sections(
      """
      ## **Activités à Lisbonne**
      - 🗺️ **Explorer les quartiers** : découvrir les rues historiques. [1, 2, 4]
      - 🏃 <feel> <boost>: They create a propulsive sensation. [<1>, [<2>]]

      ? <how do I choose the right pair?>
      ?
      ? what are the downsides
      """)

    #expect(draft.sections.map(\.heading) == ["Activités à Lisbonne"])
    let bullets = draft.sections[0].bullets
    #expect(bullets[0].lead == "Explorer les quartiers")
    #expect(bullets[0].text == "découvrir les rues historiques.")
    #expect(bullets[0].sources == [1, 2, 4])
    #expect(bullets[1].lead == "Feel boost")
    #expect(bullets[1].text == "They create a propulsive sensation.")
    #expect(bullets[1].sources == [1, 2])
    #expect(draft.followUps == ["how do I choose the right pair?", "what are the downsides?"])
  }

  @Test func `a point string from the outline reads its emoji, lead, sentence and sources`() {
    let bullet = PageMarkup.bullet("🔥 Source: Heat movement: Refrigerant captures outdoor warmth. [1, 3]")

    #expect(bullet.emoji == "🔥")
    #expect(bullet.lead == "Heat movement")
    #expect(bullet.text == "Refrigerant captures outdoor warmth.")
    #expect(bullet.sources == [1, 3])
  }

  @Test func `citations the model split into their own point join the point before`() {
    let bullets = PageMarkup.points([
      "🏛️ Monuments : Torre de Belém et le monastère des Hiéronymites (2)",
      "(4), (5)]",
      "🎨 Culture: Librairie Bertrand et azulejos [3]",
    ])

    #expect(bullets.count == 2)
    #expect(bullets[0].text == "Torre de Belém et le monastère des Hiéronymites")
    #expect(bullets[0].sources == [2, 4, 5])
    #expect(bullets[1].sources == [3])
  }
}
