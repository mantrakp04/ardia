import Foundation

enum Fixtures {
  static let duckDuckGoResults = """
    <!DOCTYPE html><html><head><title>best running shoes at DuckDuckGo</title></head><body>
    <div id="links" class="results">
      <div class="result results_links results_links_deep result--ad ">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=brooksrunning.com&amp;ad_provider=bingv7aa&amp;ad_type=txad&amp;u3=https%3A%2F%2Fwww.bing.com%2Faclick">Built For Runners - Running Shoes And More</a>
          </h2>
          <div class="result__badge-wrap"><button class="badge--ad">Ad</button></div>
          <a class="result__snippet" href="https://duckduckgo.com/y.js?ad_domain=brooksrunning.com">Shop Brooks&reg; <b>Running</b> <b>Shoes</b>.</a>
        </div>
      </div>
      <div class="result results_links results_links_deep web-result ">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="https://www.runnersworld.com/gear/a19663621/best-running-shoes/">The 15 Best Running Shoes of 2026, Tested by Runner&#x27;s World</a>
          </h2>
          <div class="result__extras"><div class="result__extras__url">
            <span class="result__icon"><img class="result__icon__img" src="//external-content.duckduckgo.com/ip3/www.runnersworld.com.ico" /></span>
            <a class="result__url" href="https://www.runnersworld.com/gear/a19663621/best-running-shoes/">www.runnersworld.com/gear/a19663621/best-running-shoes/</a>
          </div></div>
          <a class="result__snippet" href="https://www.runnersworld.com/gear/a19663621/best-running-shoes/">Find the <b>best</b> <b>running</b> <b>shoes</b> of <b>2026</b>, including picks from Adidas, Brooks &amp; Hoka.</a>
        </div>
      </div>
      <div class="result results_links results_links_deep web-result ">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rtings.com%2Frunning%2Dshoes%2Freviews%2Fbest%2Frunning%3Fsort%3Dnew&amp;rut=1b7e3c">The 5 Best Running Shoes of 2026 - RTINGS.com</a>
          </h2>
          <div class="result__snippet">If you want one pair of <b>shoes</b> for every run, the ASICS Superblast 3 is the <b>best</b> we&#x27;ve tested.</div>
        </div>
      </div>
      <div class="result results_links results_links_deep web-result ">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="https://www.runnersworld.com/gear/a19663621/best-running-shoes">Best Running Shoes 2026 | Runner&#x27;s World</a>
          </h2>
          <a class="result__snippet" href="https://www.runnersworld.com/gear/a19663621/best-running-shoes">A duplicate of the first result.</a>
        </div>
      </div>
      <div class="result results_links results_links_deep web-result ">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="https://www.youtube.com/watch?v=abc123">Best Running Shoes of 2026 (Video)</a>
          </h2>
          <a class="result__snippet" href="https://www.youtube.com/watch?v=abc123">Our top picks, on video.</a>
        </div>
      </div>
      <div class="result results_links results_links_deep web-result ">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="https://www.runnersworld.com/gear/a20000000/best-trail-shoes/">Best Trail Running Shoes</a>
          </h2>
          <a class="result__snippet" href="https://www.runnersworld.com/gear/a20000000/best-trail-shoes/">Trail picks from the same site.</a>
        </div>
      </div>
      <div class="result results_links results_links_deep web-result ">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="https://en.m.wikipedia.org/wiki/Running_shoe">Running shoe - Wikipedia</a>
          </h2>
          <a class="result__snippet" href="https://en.m.wikipedia.org/wiki/Running_shoe">A running shoe is a shoe designed for running.</a>
        </div>
      </div>
      <div class="nav-link"><form action="/html/" method="post"><input type="submit" class="btn btn--alt" value="Next" /></form></div>
    </div>
    </body></html>
    """

  static let duckDuckGoChallenge = """
    <html><body><div class="anomaly-modal__modal"><form id="challenge-form" action="/anomaly.js">
    <p>Unfortunately, bots use DuckDuckGo too.</p></form></div></body></html>
    """

  static let newsArticle = """
    <!doctype html>
    <html lang="en-GB">
    <head>
      <meta charset="utf-8">
      <title>Rail strike called off after late-night deal | The Daily Courier</title>
      <meta property="og:site_name" content="The Daily Courier">
      <meta property="og:image" content="/images/2026/10/station-crowd.jpg">
      <meta name="description" content="Unions accept a 6% pay offer.">
      <link rel="icon" href="/favicon-32.png">
      <link rel="apple-touch-icon" href="/touch-icon-180.png">
      <script>window.dataLayer = [{"page": "news"}];</script>
      <style>.cookie-banner { position: fixed; }</style>
    </head>
    <body class="page has-sidebar">
      <div id="cookie-banner" class="cookie-banner"><p>We use cookies to improve your experience. Accept all or manage preferences in settings.</p><button>Accept all</button></div>
      <header class="site-header"><nav><ul><li><a href="/">Home</a></li><li><a href="/news">News</a></li><li><a href="/sport">Sport</a></li></ul></nav></header>
      <div class="layout">
        <main>
          <article>
            <header><h1>Rail strike called off after late-night deal</h1><p class="byline">By Sam Patel, Transport Correspondent</p></header>
            <p>A national rail strike planned for Monday has been called off after union leaders accepted a revised pay offer in talks that ran past midnight on Thursday.</p>
            <p>The agreement gives about 40,000 workers a 6% rise over two years, backdated to April, along with a guarantee of no compulsory redundancies until 2028.</p>
            <div class="newsletter-signup"><p>Sign up for our morning briefing and get the day's top stories in your inbox.</p></div>
            <h2>What happens next</h2>
            <p>Services will run to a normal timetable from Monday, though operators warned that some early trains could be cancelled while crews are rescheduled.</p>
            <p>Union members will vote on the deal over the next three weeks, and leaders have said they will recommend that it is accepted.</p>
            <figure><img src="/images/2026/10/signal-box.jpg" alt=""><figcaption>A signal box near Leeds.</figcaption></figure>
            <aside class="related-stories"><h3>Related stories</h3><ul><li><a href="/a">Fares to rise in March as cap ends</a></li><li><a href="/b">New trains enter service on the coast line</a></li></ul></aside>
          </article>
        </main>
        <div class="sidebar"><h3>Most read</h3><ol><li><a href="/x">Storm warnings issued for the north as winds reach 80mph overnight</a></li></ol></div>
      </div>
      <footer class="site-footer"><p>&copy; 2026 The Daily Courier. All rights reserved.</p></footer>
    </body>
    </html>
    """

  static let recipe = """
    <!DOCTYPE html><html lang="en"><head>
    <title>The Best Banana Bread Recipe - Hearth &amp; Home Kitchen</title>
    <meta property="og:title" content="The Best Banana Bread">
    <meta property="og:site_name" content="Hearth &amp; Home Kitchen">
    <meta property="og:image" content="https://cdn.hearthhome.example/banana-bread-hero.jpg">
    </head><body>
    <div class="site-wrapper"><nav class="main-menu"><a href="/">Recipes</a> <a href="/about">About</a></nav>
    <main id="content"><article class="post">
    <h1>The Best Banana Bread</h1>
    <p>Every autumn my grandmother would fill her kitchen with the smell of cinnamon, and I spent most afternoons sitting on the counter while she told stories about growing up on the farm, the summer the creek flooded, and the year she won a ribbon at the county fair for a pie she swore she had made with her eyes closed.</p>
    <p>Years later, when I moved into my first apartment, the only thing I asked her for was a handwritten card, stained and soft at the corners, that she kept tucked in the back of an old cookbook between a bus timetable and a photo of my uncle as a boy holding a fish nearly as long as his arm.</p>
    <p>That card has travelled with me through four moves, two countries and one very small oven that only fit a single loaf tin, and I have tested every variation imaginable along the way, from brown butter to sourdough discard to a version with far too many walnuts.</p>
    <p>This is the version I keep coming back to on rainy weekends, when the fruit bowl has three forgotten bananas going spotty and the house is quiet enough to hear the oven tick as it heats.</p>
    <p>Before we get to it, a quick word about pans, because people always ask: any standard loaf tin works, metal or glass, as long as you grease it well and do not overfill it past two thirds.</p>
    <div class="ad-slot ads"><p>Advertisement</p></div>
    <h2>Ingredients</h2>
    <ul class="ingredients">
    <li>3 very ripe bananas, mashed</li>
    <li>75 g butter, melted</li>
    <li>150 g light brown sugar</li>
    <li>1 egg, beaten</li>
    <li>1 tsp vanilla extract</li>
    <li>1 tsp baking soda</li>
    <li>190 g plain flour</li>
    <li>A pinch of salt</li>
    </ul>
    <h2>Method</h2>
    <ol class="instructions">
    <li>Heat the oven to 175&deg;C and grease a 900 g loaf tin.</li>
    <li>Mix the mashed bananas with the melted butter in a large bowl.</li>
    <li>Stir in the sugar, egg and vanilla, then the baking soda and salt.</li>
    <li>Fold in the flour until just combined.</li>
    <li>Pour into the tin and bake for 55 to 65 minutes, until a skewer comes out clean.</li>
    </ol>
    <div class="comments"><h3>124 comments</h3><p>Made this twice this week and my kids loved it, thanks for sharing your grandmother's recipe with us all!</p></div>
    </article></main>
    <footer><p>Hearth &amp; Home Kitchen. Privacy Policy. Terms of Use.</p></footer>
    </div></body></html>
    """

  static let mostlyNavigation = """
    <html><head><title>Acme Outdoor | Home</title></head><body>
    <div class="topbar"><a href="/login">Sign in</a> <a href="/cart">Cart (0)</a></div>
    <nav class="mega-menu"><ul>
      <li><a href="/men">Men</a><ul><li><a href="/men/jackets">Jackets</a></li><li><a href="/men/boots">Boots</a></li></ul></li>
      <li><a href="/women">Women</a><ul><li><a href="/women/jackets">Jackets</a></li><li><a href="/women/boots">Boots</a></li></ul></li>
      <li><a href="/camping">Camping and hiking equipment for every season</a></li>
    </ul></nav>
    <div class="hero"><h1>Gear up for winter</h1><p><a href="/sale">Shop the sale now and save up to fifty percent on selected lines</a></p></div>
    <div class="grid">
      <div class="tile"><a href="/p/1">Alpine down jacket, waterproof and windproof, in four colours</a></div>
      <div class="tile"><a href="/p/2">Trail runner GTX shoes with a grippy outsole for wet ground</a></div>
      <div class="tile"><a href="/p/3">Four person dome tent with porch and quick pitch poles</a></div>
    </div>
    <p>Free delivery over 50.</p>
    <footer><ul><li><a href="/help">Help</a></li><li><a href="/returns">Returns</a></li><li><a href="/stores">Store finder and opening hours near you</a></li></ul></footer>
    </body></html>
    """
}
