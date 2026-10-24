cask "ardia" do
  version "0.2.39"
  sha256 "14d3efc2f0d2dc2fa54caa32b707d7ce3edb46a07c745a781923b8f1fb54bbdb"

  url "https://github.com/mantrakp04/ardia/releases/download/v#{version}/Ardia-#{version}.dmg",
      verified: "github.com/mantrakp04/ardia/"
  name "Ardia"
  desc "Browser with Arc's sidebar and Dia's polish on Chromium"
  homepage "https://ardia.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: ">= :sonoma"

  app "Ardia.app"

  zap trash: [
    "~/Library/Application Support/Ardia",
    "~/Library/Application Support/com.ardia.browser",
    "~/Library/Caches/com.ardia.browser",
    "~/Library/HTTPStorages/com.ardia.browser",
    "~/Library/Preferences/com.ardia.browser.plist",
    "~/Library/Saved Application State/com.ardia.browser.savedState",
  ]
end
