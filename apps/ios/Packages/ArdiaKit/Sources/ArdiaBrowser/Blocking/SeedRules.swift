import Foundation

enum SeedRules {
  static let adDomains = """
  doubleclick.net googlesyndication.com googleadservices.com googletagservices.com adservice.google.com pagead2.googlesyndication.com
  2mdn.net adnxs.com adsrvr.org rubiconproject.com pubmatic.com openx.net criteo.com criteo.net casalemedia.com
  advertising.com taboola.com outbrain.com revcontent.com mgid.com zergnet.com adform.net smartadserver.com
  amazon-adsystem.com media.net contextweb.com sharethrough.com triplelift.com teads.tv yieldmo.com indexww.com
  bidswitch.net 33across.com gumgum.com sovrn.com lijit.com districtm.io undertone.com spotxchange.com spotx.tv
  springserve.com adcolony.com applovin.com unityads.unity3d.com moatads.com adsafeprotected.com doubleverify.com
  serving-sys.com flashtalking.com innovid.com yieldlab.net adition.com adtech.de stickyadstv.com freewheel.tv
  fwmrm.net tremorhub.com adroll.com quantserve.com zemanta.com yahooinc.com ads.yahoo.com advertising.yahoo.com
  adsymptotic.com bttrack.com exponential.com tribalfusion.com conversantmedia.com mathtag.com turn.com
  rlcdn.com adsystem.com propellerads.com popads.net popcash.net exoclick.com juicyads.com trafficjunky.net
  adskeeper.com adsterra.com hilltopads.net clickadu.com onclickads.net admixer.net yieldlove.com connatix.com
  primis.tech vidazoo.com aniview.com minutemedia-prebid.com kargo.com nativo.com 3lift.com lkqd.net
  ad.doubleclick.net securepubads.g.doubleclick.net adsystem.amazon.com aax.amazon-adsystem.com
  ads.pubmatic.com ib.adnxs.com cdn.taboola.com widgets.outbrain.com ads.twitter.com ads-api.twitter.com
  ads.linkedin.com ads.reddit.com ads.tiktok.com ads.pinterest.com adservice.google.de
  """

  static let trackerDomains = """
  google-analytics.com analytics.google.com googletagmanager.com ssl.google-analytics.com stats.g.doubleclick.net
  hotjar.com hotjar.io static.hotjar.com mouseflow.com fullstory.com crazyegg.com luckyorange.com clicktale.net
  contentsquare.net quantummetric.com smartlook.com inspectlet.com logrocket.io logrocket.com heap.io heapanalytics.com
  mixpanel.com segment.com segment.io amplitude.com api.amplitude.com cdn.amplitude.com kissmetrics.com
  chartbeat.com chartbeat.net parsely.com scorecardresearch.com comscore.com newrelic.com nr-data.net
  bluekai.com krxd.net demdex.net omtrdc.net everesttech.net 2o7.net exelator.com eyeota.net
  bounceexchange.com tealiumiq.com tiqcdn.com branch.io app-measurement.com crashlytics.com
  connect.facebook.net facebook.com/tr pixel.facebook.com analytics.tiktok.com analytics.twitter.com
  static.ads-twitter.com px.ads.linkedin.com snap.licdn.com sc-static.net tr.snapchat.com ct.pinterest.com
  bat.bing.com clarity.ms c.clarity.ms trc.taboola.com yandex.ru/metrika mc.yandex.ru top-fwz1.mail.ru
  counter.yadro.ru hm.baidu.com cnzz.com statcounter.com histats.com woopra.com clicky.com getclicky.com
  optimizely.com cdn.optimizely.com logx.optimizely.com abtasty.com kameleoon.eu vwo.com visualwebsiteoptimizer.com
  dynatrace.com bam.nr-data.net js-agent.newrelic.com sentry-cdn.com browser.sentry-cdn.com
  adobedtm.com assets.adobedtm.com sc.omtrdc.net matomo.cloud piwik.pro plausible.io
  onesignal.com pushwoosh.com pushcrew.com sumo.com sumome.com addthis.com sharethis.com
  zdbb.net permutive.com permutive.app liadm.com lotame.com crwdcntrl.net id5-sync.com
  tapad.com adsymptotic.com agkn.com rfihub.com mookie1.com pippio.com intentiq.com
  """

  static let cookieSelectors = """
  #onetrust-banner-sdk
  #onetrust-consent-sdk
  #CybotCookiebotDialog
  #CybotCookiebotDialogBodyUnderlay
  #didomi-host
  .didomi-popup-backdrop
  #qc-cmp2-container
  .qc-cmp2-container
  #truste-consent-track
  .truste_box_overlay
  .truste_overlay
  #usercentrics-root
  #usercentrics-cmp-ui
  #cmpbox
  #cmpbox2
  .cmpboxBG
  #cookie-law-info-bar
  #cookie-notice
  #cookie-banner
  #cookieBanner
  #cookie-consent
  #cookieConsent
  #cookiebanner
  #cookie-bar
  #cookies-banner
  #gdpr-banner
  #gdpr-cookie-message
  #consent-banner
  #js-cookie-banner
  #iubenda-cs-banner
  #termly-code-snippet-support
  #CookieReportsBanner
  #ccc
  #cc-main
  #cookiescript_injected
  #cookiescript_injected_wrapper
  .cc-window
  .cc-banner
  .cookie-banner
  .cookie-consent
  .cookie-notice
  .cookie-bar
  .cookies-banner
  .cookieconsent
  .gdpr-banner
  .js-cookie-consent
  .cookie-law-banner
  .consent-banner
  .sp_veil
  .fc-consent-root
  .osano-cm-window
  .klaro
  .cky-consent-container
  .cky-overlay
  .cmplz-cookiebanner
  .moove-gdpr-cookie-notice
  .wpcc-container
  .t-consentPrompt
  .evidon-banner
  .optanon-alert-box-wrapper
  [aria-label="Cookie banner"]
  [aria-label="cookieconsent"]
  [id^="sp_message_container_"]
  .duet--navigation--pmc-privacy-banner
  [class*="pmc-privacy-banner"]
  #fides-overlay
  #fides-banner-container
  #bbccookies
  .gdpr-lmd-wall
  .gdpr-lmd-banner
  """

  static func list(for category: BlockingCategory) -> String {
    switch category {
    case .ads:
      adDomains.split(whereSeparator: \.isWhitespace).map { "||\($0)^" }.joined(separator: "\n")
    case .trackers:
      trackerDomains.split(whereSeparator: \.isWhitespace).filter { !$0.contains("/") }.map { "||\($0)^$third-party" }.joined(separator: "\n")
    case .cookieBanners:
      cookieSelectors.split(separator: "\n").map { "##" + $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")
    }
  }
}
