import Testing
@testable import ArdiaShared

@Suite struct ScriptEngineTests {
  @Test func syncAndAsyncCallsRoundTripJSON() throws {
    let engine = try ScriptEngine(scripts: [.sync, .core], extra: [
      "ArdiaSync.__probe = async (n) => { const listing = await __host.read(JSON.stringify(n)); return { n, listing: JSON.parse(listing) }; };",
      "ArdiaSync.__fail = async () => { await null; throw new Error('nope'); };",
    ])
    engine.register("read") { args in "{\"echo\":\(args[0])}" }
    #expect(try engine.call(.core, "resolveInput", json: ["\"apple.com\""]) == "\"https://apple.com\"")
    #expect(try engine.callAsync(.sync, "__probe", json: ["{\"a\":1}"]) == "{\"n\":{\"a\":1},\"listing\":{\"echo\":{\"a\":1}}}")
    #expect(throws: ScriptError.self) { try engine.callAsync(.sync, "__fail") }
    #expect(throws: ScriptError.self) { try engine.call(.core, "missing") }
  }
}
