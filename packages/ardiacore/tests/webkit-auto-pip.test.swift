import Foundation

@main
struct WebKitAutoPictureInPictureTests {
  static var failures = 0

  static func expect(_ actual: WebKitAutoPictureInPicture.Action, _ wanted: WebKitAutoPictureInPicture.Action, _ name: String) {
    if actual == wanted { return }
    failures += 1
    print("FAIL \(name): got \(actual), wanted \(wanted)")
  }

  static func main() {
    var rule = WebKitAutoPictureInPicture()
    expect(rule.sight(false, enabled: true, playing: true), .open, "leaving a playing tab with the setting on opens it")
    expect(rule.sight(false, enabled: true, playing: true), .none, "a second report of the same sight does nothing")
    expect(rule.sight(true, enabled: true, playing: true), .close, "returning closes what was opened on leaving")
    expect(rule.sight(true, enabled: true, playing: true), .none, "returning twice closes once")

    rule = WebKitAutoPictureInPicture()
    expect(rule.sight(false, enabled: false, playing: true), .none, "leaving with the setting off opens nothing")
    expect(rule.sight(true, enabled: false, playing: true), .none, "returning with nothing open closes nothing")

    rule = WebKitAutoPictureInPicture()
    expect(rule.sight(false, enabled: true, playing: false), .none, "leaving a tab that is not playing opens nothing")
    expect(rule.sight(true, enabled: true, playing: false), .none, "returning to a tab that opened nothing closes nothing")

    rule = WebKitAutoPictureInPicture()
    expect(rule.sight(false, enabled: true, playing: true), .open, "first leave opens")
    rule.reported(active: true)
    rule.reported(active: false)
    expect(rule.sight(false, enabled: true, playing: true), .none, "a picture in picture the user closed does not reopen while away")
    expect(rule.sight(true, enabled: true, playing: true), .none, "returning after the user closed it closes nothing")
    expect(rule.sight(false, enabled: true, playing: true), .open, "leaving again opens again")

    rule = WebKitAutoPictureInPicture()
    rule.reported(active: true)
    expect(rule.sight(false, enabled: false, playing: true), .none, "leaving never opens with the setting off")
    expect(rule.sight(true, enabled: false, playing: true), .close, "returning ends a picture in picture the page reports as open")

    rule = WebKitAutoPictureInPicture()
    expect(rule.sight(false, enabled: true, playing: true), .open, "leave before the page reports")
    expect(rule.sight(true, enabled: true, playing: true), .close, "return before the page reports closes it")
    rule.reported(active: false)
    expect(rule.sight(false, enabled: true, playing: true), .open, "the next leave opens again")

    if failures > 0 { exit(1) }
    print("ok")
  }
}
