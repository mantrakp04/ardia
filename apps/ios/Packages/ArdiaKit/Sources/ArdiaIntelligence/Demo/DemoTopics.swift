import Foundation

enum DemoTopic: CaseIterable {
  case joshuaTree
  case dogs

  static func matching(_ text: String) -> DemoTopic {
    text.lowercased().contains("dog") ? .dogs : .joshuaTree
  }

  static func containing(_ result: SearchResult) -> DemoTopic {
    allCases.first { $0.results.contains(result) } ?? .joshuaTree
  }

  var results: [SearchResult] {
    let rows: [(String, String, String)] =
      switch self {
      case .joshuaTree: [
        ("https://www.nps.gov/jotr/planyourvisit/things2do.htm", "Things To Do - Joshua Tree National Park", "Hike, climb, stargaze and explore the desert where the Mojave and Colorado meet."),
        ("https://en.wikipedia.org/wiki/Joshua_Tree_National_Park", "Joshua Tree National Park - Wikipedia", "Joshua Tree National Park is an American national park in southeastern California."),
        ("https://www.visitcalifornia.com/places-to-visit/joshua-tree-national-park/", "Joshua Tree National Park | Visit California", "Plan a trip to see surreal rock formations, spiky trees and dark night skies."),
        ("https://www.cntraveler.com/story/best-things-to-do-in-joshua-tree", "The Best Things to Do in Joshua Tree", "From Skull Rock to Keys View, the stops worth your time on a first visit."),
        ("https://www.outsideonline.com/adventure-travel/joshua-tree-guide", "The Ultimate Joshua Tree Guide", "Where to hike, camp and climb, and when to go."),
        ("https://www.lonelyplanet.com/usa/california/joshua-tree-national-park", "Joshua Tree National Park travel", "Lonely Planet's guide to the park, its towns and its trails."),
        ]
      case .dogs: [
        ("https://en.wikipedia.org/wiki/Dog", "Dog - Wikipedia", "The dog is a domesticated descendant of the gray wolf."),
        ("https://www.britannica.com/animal/dog", "Dog | History, Domestication, Physical Traits, & Breeds", "Dog, a domestic mammal of the family Canidae."),
        ("https://www.nationalgeographic.com/animals/mammals/facts/domestic-dog", "Dog, facts and photos", "Dogs were the first animals people domesticated."),
        ("https://www.akc.org/expert-advice/lifestyle/dog-facts/", "Fun Facts About Dogs", "From noses to tails, what makes dogs so good at their jobs."),
        ("https://www.smithsonianmag.com/science-nature/how-dogs-were-domesticated", "How Dogs Became Our Best Friends", "The long road from wolf to companion."),
        ("https://www.amnh.org/explore/news-blogs/dogs-and-people", "Dogs and People", "A shared history that goes back to the Ice Age."),
        ]
      }
    return rows.map { SearchResult(url: URL(string: $0.0)!, title: $0.1, snippet: $0.2) }
  }

  var siteNames: [String] {
    switch self {
    case .joshuaTree: ["National Park Service", "Wikipedia", "Visit California", "Cond\u{00E9} Nast Traveler", "Outside", "Lonely Planet"]
    case .dogs: ["Wikipedia", "Britannica", "National Geographic", "American Kennel Club", "Smithsonian", "AMNH"]
    }
  }

  var artwork: [Int: DemoArtwork.Scene] {
    switch self {
    case .joshuaTree: [0: .sunset, 1: .night, 2: .boulders]
    case .dogs: [:]
    }
  }

  func passages(for index: Int) -> [String] {
    let snippet = results[index].snippet
    switch self {
    case .joshuaTree:
      return [snippet + " " + snippet]
    case .dogs:
      let extra = [
        "Dogs were the first species to be domesticated, by hunter-gatherers more than 15,000 years ago.",
        "Selective breeding has produced hundreds of breeds, from the Chihuahua to the Great Dane.",
        "A dog's nose holds hundreds of millions of scent receptors, far more than a person's.",
      ]
      return [snippet, extra[index % extra.count]]
    }
  }

  var draft: BrowsePageDraft {
    switch self {
    case .joshuaTree:
      BrowsePageDraft(
        title: "A First Visit to Joshua Tree",
        answer: "Joshua Tree rewards an early start: hike a short trail at sunrise, climb on the boulders around Hidden Valley, drive up to Keys View for the sunset, and stay for some of the darkest skies in Southern California.",
        sections: [
          .init(heading: "Short Hikes", bullets: [
            .init(emoji: "\u{1F97E}", lead: "Hidden Valley", text: "A one mile loop through boulders, once used to hide cattle.", sources: [1, 4]),
            .init(emoji: "\u{1F335}", lead: "Cholla Cactus Garden", text: "A quarter mile path through dense teddy bear cholla, best at golden hour.", sources: [1, 3]),
            .init(emoji: "\u{1FAA8}", lead: "Skull Rock", text: "A roadside rock shaped like a skull, with an easy trail behind it.", sources: [4]),
          ]),
          .init(heading: "Views and Night Skies", bullets: [
            .init(emoji: "\u{1F304}", lead: "Keys View", text: "A paved overlook at 5,185 feet with views over the Coachella Valley.", sources: [2, 4]),
            .init(emoji: "\u{2728}", lead: "Stargazing", text: "The park is a certified International Dark Sky Park.", sources: [1, 2]),
          ]),
          .init(heading: "When to Go", bullets: [
            .init(emoji: "\u{1F321}\u{FE0F}", lead: "Spring and fall", text: "Days are mild from March to May and October to November.", sources: [3, 5]),
            .init(emoji: "\u{1F697}", lead: "Arrive early", text: "Parking at popular trailheads fills by mid morning on weekends.", sources: [1, 6]),
          ]),
        ],
        followUps: ["Where should I camp in Joshua Tree?", "Is Joshua Tree good for kids?", "What should I pack for the desert?"])
    case .dogs:
      BrowsePageDraft(
        title: "Dogs: A Comprehensive Overview",
        answer: "Dogs are domesticated descendants of the gray wolf, bred over thousands of years into hundreds of breeds that herd, guard, guide and keep people company.",
        sections: [
          .init(heading: "The Basics", bullets: [
            .init(emoji: "\u{1F415}", lead: "Classification", text: "Dogs are Canis familiaris, a close relative of the gray wolf, Canis lupus.", sources: [1, 2]),
            .init(emoji: "\u{1F4C5}", lead: "Domestication", text: "People domesticated dogs more than 15,000 years ago, before farming began.", sources: [2, 3]),
            .init(emoji: "\u{1F30D}", lead: "Population", text: "There are an estimated 700 million to a billion dogs worldwide.", sources: [3]),
          ]),
          .init(heading: "Life with People", bullets: [
            .init(emoji: "\u{1F3E0}", lead: "Roles", text: "Dogs work as companions, guides, herders, hunters and police dogs.", sources: [1, 4]),
            .init(emoji: "\u{1F443}", lead: "Senses", text: "Their sense of smell is tens of thousands of times keener than ours.", sources: [4]),
            .init(emoji: "\u{1F43E}", lead: "Breeds", text: "Kennel clubs recognize around 200 to 360 breeds.", sources: [2, 4]),
          ]),
        ],
        followUps: ["Dog breeds", "History of domestication", "How long do dogs live?"])
    }
  }
}
