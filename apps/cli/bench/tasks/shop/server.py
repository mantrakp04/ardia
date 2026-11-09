#!/usr/bin/env python3
import re
import sys
import threading
from html import escape
from pathlib import Path
from urllib.parse import quote_plus

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from benchhttp import Handler, now_ms, serve_forever
from catalog import CATEGORIES, COUPONS, POSTS, PRODUCTS, SHIPPING, STATES

PORT = 8821
TODAY = "2026-11-06"
PAGE_SIZE = 12
TAX_RATE = 0.08625
SAVED_ADDRESS = {"name": "Jordan Lee", "company": "", "line1": "2290 Fulton St", "line2": "Apt 4", "city": "San Francisco",
                 "state": "CA", "zip": "94117", "phone": "(415) 555-0198"}
EXPECTED = {"sku": "DK-2814", "qty": 3, "coupon": "DESKDAYS", "shipping": "expedited"}
BY_SKU = {p["sku"]: p for p in PRODUCTS}
CAT_NAME = dict((slug, name) for slug, name, _ in CATEGORIES)
SORTS = [("featured", "Featured"), ("price-asc", "Price: low to high"), ("price-desc", "Price: high to low"),
         ("rating", "Customer rating"), ("newest", "Newest")]
LOCK = threading.Lock()
STATE = {}


def reset_state():
    STATE.update(cart=[], coupon=None, orders=[], flash=None, coupon_attempts=0, coupon_rejections=0,
                 checkout_attempts=0, checkout_errors=0, reset_at_ms=now_ms())


def slug_of(p):
    return re.sub(r"[^a-z0-9]+", "-", p["name"].lower()).strip("-") + "-" + p["sku"].lower().replace("-", "")


BY_SLUG = {slug_of(p): p for p in PRODUCTS}


def usd(cents):
    return f"${cents / 100:,.2f}"


def cart_lines():
    return [(BY_SKU[sku], qty) for sku, qty in STATE["cart"] if sku in BY_SKU]


def coupon_problem(code, lines):
    c = COUPONS.get(code)
    subtotal = sum(p["price"] * q for p, q in lines)
    if not c:
        return f"“{code}” isn't a valid promo code."
    if c["ends"] < TODAY:
        return f"Promo code {code} expired on {month_day(c['ends'])}."
    if c["cats"] and not any(p["cat"] in c["cats"] for p, _ in lines):
        return f"Promo code {code} doesn't apply to the items in your cart."
    if subtotal < c["min"]:
        return f"Promo code {code} needs a subtotal of {usd(c['min'])} or more."
    return None


def month_day(iso):
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{months[int(iso[5:7]) - 1]} {int(iso[8:])}, {iso[:4]}"


def totals(shipping_id="standard"):
    lines = cart_lines()
    subtotal = sum(p["price"] * q for p, q in lines)
    code = STATE["coupon"]
    discount = 0
    if code and not coupon_problem(code, lines):
        c = COUPONS[code]
        eligible = sum(p["price"] * q for p, q in lines if not c["cats"] or p["cat"] in c["cats"])
        discount = round(eligible * c["percent"] / 100)
    method = next((m for m in SHIPPING if m[0] == shipping_id), SHIPPING[0])
    shipping = method[2] if subtotal - discount >= 9900 else method[3]
    tax = round((subtotal - discount) * TAX_RATE)
    return {"lines": lines, "subtotal": subtotal, "coupon": code if discount else None, "discount": discount,
            "shipping": shipping, "tax": tax, "total": subtotal - discount + shipping + tax, "count": sum(q for _, q in lines)}


def stars(p):
    full = int(round(p["rating"]))
    return (f'<span class="stars" aria-label="Rated {p["rating"]} out of 5">{"★" * full}{"☆" * (5 - full)}</span>'
            f' <span class="muted">{p["rating"]} ({p["reviews"]:,})</span>')


def price_html(p, big=False):
    cls = "price big" if big else "price"
    if p["was"]:
        return (f'<p class="{cls}"><span class="now sale">{usd(p["price"])}</span> <s class="was" aria-label="Was {usd(p["was"])}">'
                f'{usd(p["was"])}</s> <span class="save">Save {usd(p["was"] - p["price"])}</span></p>')
    return f'<p class="{cls}"><span class="now">{usd(p["price"])}</span></p>'


def thumb(p, size=""):
    hue = sum(map(ord, p["brand"])) % 360
    return (f'<div class="thumb {size} t-{p["cat"]}" style="--h:{hue}" aria-hidden="true"><span>{escape(p["brand"][:1])}</span></div>')


def card(p):
    url = f"/p/{slug_of(p)}"
    return (f'<li class="card">{thumb(p)}<p class="brand-name">{escape(p["brand"])}</p>'
            f'<h3><a href="{url}">{escape(p["name"])}</a></h3><p class="bullets">{escape(p["card"])}</p>{stars(p)}{price_html(p)}'
            f'<form method="post" action="/cart/add"><input type="hidden" name="sku" value="{p["sku"]}"><input type="hidden" name="qty" value="1">'
            f'<button class="btn small" type="submit">Add to cart<span class="sr"> – {escape(p["name"])}</span></button></form></li>')


def layout(title, body, active=None, flash=None):
    with LOCK:
        count = sum(q for _, q in STATE["cart"])
        flash = flash or STATE["flash"]
        STATE["flash"] = None
    nav = "".join(f'<a href="/c/{slug}"{" aria-current=\"page\"" if slug == active else ""}>{escape(name)}</a>' for slug, name, _ in CATEGORIES)
    flash_html = f'<div class="flash {flash[0]}" role="status">{flash[1]}</div>' if flash else ""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)} | Kestrel Supply</title><link rel="stylesheet" href="/static/shop.css"></head><body>
<a class="skip" href="#main">Skip to content</a>
<div class="promo-strip">Free standard shipping on orders over $99 · Take 10% off orders of $150+ with code <strong>FALL10</strong> through Nov 30</div>
<header class="top"><div class="wrap top-row">
<a class="logo" href="/"><svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#1f3a5f"/><path d="M7 21 L14 7 L21 21 L14 16 Z" fill="#ff9f43"/></svg>Kestrel Supply</a>
<form class="search" role="search" action="/search"><label class="sr" for="q">Search products</label><input id="q" name="q" type="search" placeholder="Search docks, monitors, cables…"><button class="btn" type="submit">Search</button></form>
<a class="acct" href="/account">Jordan's account</a><a class="cart-link" href="/cart">Cart <span class="badge">{count}</span><span class="sr"> items</span></a>
</div><nav class="cats wrap" aria-label="Departments">{nav}<a href="/deals" class="deals"{' aria-current="page"' if active == "deals" else ""}>Deals</a><a href="/blog"{' aria-current="page"' if active == "blog" else ""}>Guides</a></nav></header>
<main id="main" class="wrap">{flash_html}{body}</main>
<footer class="foot"><div class="wrap"><p><strong>Kestrel Supply</strong> · Office tech for teams and home desks · Oakland, CA</p>
<p><a href="/help/shipping">Shipping</a> · <a href="/help/returns">30-day returns</a> · <a href="/help/contact">Contact us</a></p><p class="muted">Prices in USD. © 2026 Kestrel Supply Co.</p></div></footer>
<script src="/static/shop.js"></script></body></html>"""


def category_page(slug, q):
    sort = q.get("sort", "featured") if q.get("sort") in dict(SORTS) else "featured"
    items = [p for p in PRODUCTS if p["cat"] == slug]
    keys = {"featured": lambda p: p["rank"], "price-asc": lambda p: (p["price"], p["rank"]), "price-desc": lambda p: (-p["price"], p["rank"]),
            "rating": lambda p: (-p["rating"], -p["reviews"]), "newest": lambda p: (p["added"], -p["rank"])}
    items.sort(key=keys[sort], reverse=sort == "newest")
    pages = max(1, -(-len(items) // PAGE_SIZE))
    page = min(max(int(q.get("page", "1")) if q.get("page", "1").isdigit() else 1, 1), pages)
    shown = items[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    blurb = next(b for s, _, b in CATEGORIES if s == slug)
    options = "".join(f'<option value="{v}"{" selected" if v == sort else ""}>{t}</option>' for v, t in SORTS)
    link = lambda n: f"/c/{slug}?sort={sort}&amp;page={n}"
    pager = "".join(f'<li><a href="{link(n)}"{" aria-current=\"page\"" if n == page else ""}>{n}</a></li>' for n in range(1, pages + 1))
    prev_link = f'<li><a href="{link(page - 1)}" rel="prev">‹ Previous</a></li>' if page > 1 else ""
    next_link = f'<li><a href="{link(page + 1)}" rel="next">Next ›</a></li>' if page < pages else ""
    banner = ""
    if slug == "monitors":
        banner = '<div class="cat-banner">Screen week: <strong>25% off monitors</strong> with code <strong>SCREENS25</strong> through Nov 22.</div>'
    first, last = (page - 1) * PAGE_SIZE + 1, (page - 1) * PAGE_SIZE + len(shown)
    body = (f'<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › {escape(CAT_NAME[slug])}</nav>'
            f'<h1>{escape(CAT_NAME[slug])}</h1><p class="muted">{escape(blurb)}</p>{banner}'
            f'<div class="toolbar"><p class="muted" role="status">Showing {first}–{last} of {len(items)} results</p>'
            f'<form method="get" class="sort-form"><label for="sort">Sort by</label><select id="sort" name="sort" data-autosubmit>{options}</select>'
            f'<button class="btn small" type="submit">Apply</button></form></div>'
            f'<ul class="grid">{"".join(card(p) for p in shown)}</ul>'
            f'<nav class="pager" aria-label="Pagination"><ul>{prev_link}{pager}{next_link}</ul></nav>')
    return layout(f"{CAT_NAME[slug]}" + (f" – Page {page}" if page > 1 else ""), body, slug)


def product_page(p):
    specs = "".join(f"<tr><th scope=\"row\">{escape(k)}</th><td>{escape(v)}</td></tr>" for k, v in p["specs"])
    related = [x for x in PRODUCTS if x["cat"] == p["cat"] and x is not p][:4]
    qty_opts = "".join(f'<option value="{n}">{n}</option>' for n in range(1, 11))
    body = (f'<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/c/{p["cat"]}">{escape(CAT_NAME[p["cat"]])}</a> › {escape(p["name"])}</nav>'
            f'<div class="pdp">{thumb(p, "large")}<div><p class="brand-name">{escape(p["brand"])}</p><h1>{escape(p["name"])}</h1>'
            f'<p class="muted">Item # {p["sku"]}</p>{stars(p)}{price_html(p, True)}<p class="bullets">{escape(p["card"])}</p>'
            f'<p class="stock">In stock · ships from Oakland, CA</p>'
            f'<form method="post" action="/cart/add" class="buy"><input type="hidden" name="sku" value="{p["sku"]}">'
            f'<label for="qty">Quantity</label><select id="qty" name="qty">{qty_opts}</select>'
            f'<button class="btn primary" type="submit">Add to cart</button></form></div></div>'
            f'<section aria-labelledby="specs-h"><h2 id="specs-h">Specifications</h2><table class="specs"><tbody>{specs}</tbody></table></section>'
            f'<section aria-labelledby="rel-h"><h2 id="rel-h">You might also like</h2><ul class="grid four">{"".join(card(x) for x in related)}</ul></section>')
    return layout(p["name"], body, p["cat"])


def cart_page():
    with LOCK:
        t = totals()
    if not t["lines"]:
        return layout("Cart", '<h1>Your cart</h1><p>Your cart is empty.</p><p><a class="btn primary" href="/c/docks-hubs">Shop docks &amp; hubs</a></p>')
    rows = "".join(
        f'<tr><td><a href="/p/{slug_of(p)}">{escape(p["name"])}</a><div class="muted small">Item # {p["sku"]}</div></td><td>{usd(p["price"])}</td>'
        f'<td><form method="post" action="/cart/update" class="qty-form"><input type="hidden" name="sku" value="{p["sku"]}">'
        f'<label class="sr" for="q-{p["sku"]}">Quantity for {escape(p["name"])}</label><input id="q-{p["sku"]}" name="qty" type="number" min="0" max="20" value="{q}">'
        f'<button class="btn small" type="submit">Update</button></form></td><td class="num">{usd(p["price"] * q)}</td>'
        f'<td><form method="post" action="/cart/remove"><input type="hidden" name="sku" value="{p["sku"]}"><button class="link" type="submit">Remove<span class="sr"> {escape(p["name"])}</span></button></form></td></tr>'
        for p, q in t["lines"])
    applied = ""
    if t["coupon"]:
        c = COUPONS[t["coupon"]]
        scope = "everything" if not c["cats"] else " and ".join(CAT_NAME[x] for x in sorted(c["cats"]))
        applied = (f'<p class="applied">Code <strong>{t["coupon"]}</strong> applied: {c["percent"]}% off {escape(scope)}.'
                   f' <form method="post" action="/cart/coupon/remove" class="inline"><button class="link" type="submit">Remove code</button></form></p>')
    body = (f'<h1>Your cart</h1><div class="cart-layout"><div><table class="cart"><thead><tr><th>Item</th><th>Price</th><th>Quantity</th><th class="num">Total</th><th><span class="sr">Actions</span></th></tr></thead><tbody>{rows}</tbody></table>'
            f'<form method="post" action="/cart/coupon" class="coupon"><label for="code">Promo code</label><div class="row"><input id="code" name="code" autocomplete="off" spellcheck="false"><button class="btn" type="submit">Apply</button></div>'
            f'<p class="muted small">One promo code per order. A new code replaces the current one.</p></form>{applied}</div>'
            f'<section class="summary" aria-label="Order summary"><h2>Summary</h2><dl><dt>Subtotal ({t["count"]} items)</dt><dd>{usd(t["subtotal"])}</dd>'
            + (f'<dt>Discount ({t["coupon"]})</dt><dd>−{usd(t["discount"])}</dd>' if t["discount"] else "")
            + f'<dt>Shipping</dt><dd>Calculated at checkout</dd><dt>Estimated tax</dt><dd>{usd(t["tax"])}</dd></dl>'
            f'<a class="btn primary block" href="/checkout">Checkout</a></section></div>')
    return layout("Cart", body)


FIELDS = [("name", "Full name", "name"), ("company", "Company (optional)", "organization"), ("line1", "Street address", "address-line1"),
          ("line2", "Apt, suite, floor (optional)", "address-line2"), ("city", "City", "address-level2"), ("state", "State", "address-level1"),
          ("zip", "ZIP code", "postal-code"), ("phone", "Phone", "tel")]


def validate_checkout(form):
    errors = {}
    if form.get("ship_to") not in ("saved", "new"):
        errors["ship_to"] = "Choose where to ship your order."
    if form.get("ship_to") == "new":
        for key, label, _ in FIELDS:
            if key in ("company", "line2"):
                continue
            if not form.get(key, "").strip():
                errors[key] = f"Enter your {label.lower()}." if key != "state" else "Choose a state."
        if form.get("state") and form["state"] not in STATES:
            errors["state"] = "Choose a state."
        if form.get("zip", "").strip() and not re.fullmatch(r"\d{5}(-\d{4})?", form["zip"].strip()):
            errors["zip"] = "Enter a 5-digit ZIP code."
        if form.get("phone", "").strip() and not re.fullmatch(r"\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}", form["phone"].strip()):
            errors["phone"] = "Enter a 10-digit phone number, like 415-555-0123."
    if form.get("shipping") not in {m[0] for m in SHIPPING}:
        errors["shipping"] = "Choose a delivery method."
    return errors


def checkout_page(form=None, errors=None):
    form, errors = form or {"ship_to": "saved", "shipping": "standard"}, errors or {}
    with LOCK:
        t = totals(form.get("shipping", "standard"))
    if not t["lines"]:
        return None
    summary_errors = "".join(f'<li><a href="#{k if k != "ship_to" else "ship-new"}">{escape(m)}</a></li>' for k, m in errors.items())
    err_box = f'<div class="error-summary" role="alert" tabindex="-1"><h2>Please fix {len(errors)} problem{"s" if len(errors) > 1 else ""}</h2><ul>{summary_errors}</ul></div>' if errors else ""

    def field(key, label, auto):
        err = errors.get(key)
        attrs = f' aria-invalid="true" aria-describedby="{key}-err"' if err else ""
        msg = f'<p class="err" id="{key}-err">{escape(err)}</p>' if err else ""
        val = escape(form.get(key, ""))
        if key == "state":
            opts = '<option value="">Select</option>' + "".join(f'<option{" selected" if s == form.get("state") else ""}>{s}</option>' for s in STATES)
            control = f'<select id="state" name="state" autocomplete="{auto}"{attrs}>{opts}</select>'
        else:
            control = f'<input id="{key}" name="{key}" value="{val}" autocomplete="{auto}"{attrs}>'
        return f'<div class="field f-{key}"><label for="{key}">{label}</label>{control}{msg}</div>'

    saved = SAVED_ADDRESS
    ship_new = form.get("ship_to") == "new"
    cost = lambda m: m[2] if t["subtotal"] - t["discount"] >= 9900 else m[3]
    methods = "".join(
        f'<label class="method"><input type="radio" name="shipping" value="{m[0]}" data-cost="{cost(m)}"{" checked" if form.get("shipping") == m[0] else ""}>'
        f'<span><strong>{m[1]}</strong> · {"Free" if cost(m) == 0 else usd(cost(m))}'
        f'<br><span class="muted">{m[4]}</span></span></label>' for m in SHIPPING)
    lines = "".join(f'<li>{q} × {escape(p["name"])}<span>{usd(p["price"] * q)}</span></li>' for p, q in t["lines"])
    body = (f'<h1>Checkout</h1>{err_box}<form method="post" action="/checkout" class="checkout" novalidate><div class="co-main">'
            f'<fieldset><legend>Ship to</legend>'
            f'<label class="method"><input type="radio" name="ship_to" value="saved"{"" if ship_new else " checked"}><span><strong>Home</strong><br>'
            f'<span class="muted">{saved["name"]}, {saved["line1"]}, {saved["line2"]}, {saved["city"]}, {saved["state"]} {saved["zip"]}</span></span></label>'
            f'<label class="method"><input type="radio" id="ship-new" name="ship_to" value="new"{" checked" if ship_new else ""}><span><strong>Ship to a new address</strong></span></label>'
            f'<div class="new-address">{"".join(field(*f) for f in FIELDS)}</div></fieldset>'
            f'<fieldset><legend>Delivery method</legend>{methods}{"<p class=err>" + escape(errors["shipping"]) + "</p>" if "shipping" in errors else ""}'
            f'<p class="muted small">Business days only. Orders placed after 2 PM PT ship the next business day.</p></fieldset>'
            f'<fieldset><legend>Payment</legend><label class="method"><input type="radio" name="payment" value="card-4417" checked><span><strong>Visa ending 4417</strong><br><span class="muted">Jordan Lee · exp 09/28</span></span></label></fieldset></div>'
            f'<section class="summary" aria-label="Order summary"><h2>Order summary</h2><ul class="lines">{lines}</ul><dl>'
            f'<dt>Subtotal</dt><dd>{usd(t["subtotal"])}</dd>'
            + (f'<dt>Discount ({t["coupon"]})</dt><dd>−{usd(t["discount"])}</dd>' if t["discount"] else "")
            + f'<dt>Shipping</dt><dd id="ship-cost">{"Free" if not t["shipping"] else usd(t["shipping"])}</dd><dt>Tax</dt><dd>{usd(t["tax"])}</dd><dt class="total">Total</dt><dd class="total" id="order-total" data-before-shipping="{t["total"] - t["shipping"]}">{usd(t["total"])}</dd></dl>'
            f'<p class="muted small"><a href="/cart">Edit cart or promo code</a></p><button class="btn primary block" type="submit">Place order</button></section></form>')
    return layout("Checkout", body)


def place_order(form):
    with LOCK:
        STATE["checkout_attempts"] += 1
        errors = validate_checkout(form)
        if errors or not STATE["cart"]:
            STATE["checkout_errors"] += 1
            return None, errors
        t = totals(form["shipping"])
        address = dict(SAVED_ADDRESS) if form["ship_to"] == "saved" else {k: form.get(k, "").strip() for k, _, _ in FIELDS}
        number = f"KS-{104880 + len(STATE['orders']) * 7 + 3}"
        STATE["orders"].append({"number": number, "at_ms": now_ms(), "items": [(p["sku"], q) for p, q in t["lines"]], "coupon": t["coupon"],
                                "address": address, "shipping": form["shipping"], "total": t["total"]})
        STATE["cart"], STATE["coupon"] = [], None
    return number, {}


def order_page(number):
    with LOCK:
        o = next((x for x in STATE["orders"] if x["number"] == number), None)
    if not o:
        return None
    a = o["address"]
    items = "".join(f'<li>{q} × {escape(BY_SKU[s]["name"])} <span class="muted">(Item # {s})</span></li>' for s, q in o["items"])
    method = next(m for m in SHIPPING if m[0] == o["shipping"])
    body = (f'<div class="confirm"><h1>Thanks, Jordan! Your order is placed.</h1><p>Order number <strong>{number}</strong> · a receipt is on its way to jordan@northwind.dev.</p>'
            f'<h2>Items</h2><ul>{items}</ul><h2>Shipping to</h2><p>{escape(a["name"])}<br>{escape(a.get("company", "")) + "<br>" if a.get("company") else ""}{escape(a["line1"])} {escape(a.get("line2", ""))}<br>'
            f'{escape(a["city"])}, {escape(a["state"])} {escape(a["zip"])}</p><p>{method[1]} · {method[4]}</p>'
            f'<p>{"Promo code " + o["coupon"] + " applied · " if o["coupon"] else ""}Total charged {usd(o["total"])}</p><p><a href="/">Continue shopping</a></p></div>')
    return layout(f"Order {number}", body)


def deals_page():
    deals = [("DESKDAYS", "15% off docks, hubs, cables & adapters", "Desk Days: upgrade your one-cable setup. Ends Nov 15."),
             ("SCREENS25", "25% off monitors", "Screen week on every monitor we carry. Ends Nov 22."),
             ("FALL10", "10% off orders of $150+", "Our fall thank-you, sitewide. Ends Nov 30.")]
    sale = sorted([p for p in PRODUCTS if p["was"]], key=lambda p: p["price"] - p["was"])[:8]
    cards = "".join(f'<li class="deal"><p class="code">{c}</p><h3>{escape(t)}</h3><p class="muted">{escape(d)}</p></li>' for c, t, d in deals)
    body = (f'<h1>Deals</h1><p class="muted">Enter a code in your cart. One code per order.</p><ul class="deals-grid">{cards}</ul>'
            f'<h2>On sale now</h2><ul class="grid four">{"".join(card(p) for p in sale)}</ul>')
    return layout("Deals", body, "deals")


def blog_page(slug=None):
    if slug is None:
        items = "".join(f'<li><a href="/blog/{s}">{escape(t)}</a> <span class="muted">· {month_day(d)}</span><p>{escape(paras[0])}</p></li>' for s, t, d, paras in POSTS)
        return layout("Guides", f'<h1>Guides &amp; news</h1><ul class="posts">{items}</ul>', "blog")
    post = next((x for x in POSTS if x[0] == slug), None)
    if not post:
        return None
    paras = "".join(f"<p>{escape(x)}</p>" for x in post[3])
    return layout(post[1], f'<article class="post"><p class="muted">{month_day(post[2])}</p><h1>{escape(post[1])}</h1>{paras}</article>', "blog")


def home_page():
    tiles = "".join(f'<li><a class="tile" href="/c/{s}"><strong>{escape(n)}</strong><span class="muted">{escape(b)}</span></a></li>' for s, n, b in CATEGORIES)
    picks = [BY_SKU[s] for s in ("MN-3100", "DK-4016", "KB-3137", "PW-3100")]
    body = (f'<section class="hero"><h1>Your desk, sorted.</h1><p>Docks, displays and the cables between them, shipped from Oakland.</p>'
            f'<a class="btn primary" href="/deals">See this week\'s deals</a></section><h2>Shop by department</h2><ul class="tiles">{tiles}</ul>'
            f'<h2>Popular right now</h2><ul class="grid four">{"".join(card(p) for p in picks)}</ul>')
    return layout("Office tech for every desk", body)


def search_page(q):
    terms = [t for t in q.lower().split() if t]
    hits = [p for p in PRODUCTS if terms and all(t in (p["name"] + " " + p["brand"] + " " + p["card"] + " " + CAT_NAME[p["cat"]]).lower() for t in terms)]
    body = (f'<h1>Results for “{escape(q)}”</h1><p class="muted" role="status">{len(hits)} result{"s" if len(hits) != 1 else ""}</p>'
            + (f'<ul class="grid">{"".join(card(p) for p in hits[:24])}</ul>' if hits else "<p>Try a different search.</p>"))
    return layout(f"Search: {q}", body)


def account_page():
    a = SAVED_ADDRESS
    body = (f'<h1>Jordan\'s account</h1><h2>Saved address</h2><p>{a["name"]}<br>{a["line1"]}, {a["line2"]}<br>{a["city"]}, {a["state"]} {a["zip"]}</p>'
            '<h2>Past orders</h2><table class="cart"><thead><tr><th>Order</th><th>Date</th><th>Items</th><th class="num">Total</th></tr></thead><tbody>'
            '<tr><td>KS-098412</td><td>Sep 18, 2026</td><td>1 × Kestrel 140W GaN Charger, 3 ports</td><td class="num">$97.75</td></tr>'
            '<tr><td>KS-091207</td><td>Jul 2, 2026</td><td>2 × Kestrel USB-C to USB-C 240W Cable, 2 m</td><td class="num">$43.42</td></tr></tbody></table>')
    return layout("Account", body)


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", re.sub(r"\s+", " ", (s or "").lower())).strip()


def check():
    with LOCK:
        orders = [dict(o) for o in STATE["orders"]]
        counters = {k: STATE[k] for k in ("coupon_attempts", "coupon_rejections", "checkout_attempts", "checkout_errors")}
        reset_at = STATE["reset_at_ms"]
    details = dict(counters, orders_placed=len(orders))
    if not orders:
        details["wrong"] = ["no order placed"]
        return {"pass": False, "matched": 0, "total": 6, "completed_at_ms": None, "reset_at_ms": reset_at, "details": details}
    o = orders[-1]
    a = o["address"]
    street = norm(a.get("line1", "") + " " + a.get("line2", "")).replace("street", "st").replace("suite", "ste")
    items = {
        "sku": any(s == EXPECTED["sku"] for s, _ in o["items"]),
        "quantity": any(s == EXPECTED["sku"] and q == EXPECTED["qty"] for s, q in o["items"]),
        "no_other_items": len(o["items"]) == 1,
        "coupon": o["coupon"] == EXPECTED["coupon"],
        "address": norm(a.get("name")) == "jordan lee" and "548 market st" in street and re.search(r"\b(ste|#)? ?1200\b", street) is not None
        and norm(a.get("city")) == "san francisco" and a.get("state") == "CA" and a.get("zip", "")[:5] == "94104",
        "shipping_method": o["shipping"] == EXPECTED["shipping"],
    }
    passed = all(items.values())
    details.update(wrong=[k for k, v in items.items() if not v],
                   produced={"order": o["number"], "items": o["items"], "coupon": o["coupon"], "address": a, "shipping": o["shipping"]})
    return {"pass": passed, "matched": sum(items.values()), "total": len(items), "completed_at_ms": o["at_ms"] if passed else None,
            "reset_at_ms": reset_at, "details": details}


class ShopHandler(Handler):
    def page(self, text):
        return self.html(200, text) if text else self.html(404, layout("Not found", "<h1>Page not found</h1><p><a href=\"/\">Back to the store</a></p>"))

    def do_GET(self):
        path, q = self.path_only, self.query
        if path == "/api/check":
            return self.send(200, check())
        if path.startswith("/static/"):
            return self.static(path[len("/static"):])
        if path == "/":
            return self.page(home_page())
        if path.startswith("/c/") and path[3:] in CAT_NAME:
            return self.page(category_page(path[3:], q))
        if path.startswith("/p/") and path[3:] in BY_SLUG:
            return self.page(product_page(BY_SLUG[path[3:]]))
        if path == "/cart":
            return self.page(cart_page())
        if path == "/checkout":
            text = checkout_page()
            return self.page(text) if text else self.redirect("/cart")
        if path.startswith("/orders/"):
            return self.page(order_page(path[len("/orders/"):]))
        if path == "/deals":
            return self.page(deals_page())
        if path == "/blog":
            return self.page(blog_page())
        if path.startswith("/blog/"):
            return self.page(blog_page(path[len("/blog/"):]))
        if path == "/search":
            return self.page(search_page(q.get("q", "")))
        if path == "/account":
            return self.page(account_page())
        return self.page(None)

    def do_POST(self):
        path = self.path_only
        if path == "/api/reset":
            with LOCK:
                reset_state()
            return self.send(200, {"ok": True})
        form = self.body_form()
        if path == "/checkout":
            number, errors = place_order(form)
            if number:
                return self.redirect(f"/orders/{number}")
            text = checkout_page(form, errors)
            return self.html(422, text) if text else self.redirect("/cart")
        sku = form.get("sku", "")
        qty = int(form["qty"]) if form.get("qty", "").strip().isdigit() else None
        with LOCK:
            cart = STATE["cart"]
            if path == "/cart/add" and sku in BY_SKU and qty:
                existing = next((line for line in cart if line[0] == sku), None)
                if existing:
                    existing[1] = min(existing[1] + qty, 20)
                else:
                    cart.append([sku, min(qty, 20)])
                STATE["flash"] = ("ok", f"Added {qty} × {escape(BY_SKU[sku]['name'])} to your cart.")
            elif path == "/cart/update" and qty is not None:
                for line in cart:
                    if line[0] == sku:
                        line[1] = min(qty, 20)
                STATE["cart"] = [line for line in cart if line[1] > 0]
                STATE["flash"] = ("ok", "Cart updated.")
            elif path == "/cart/remove":
                STATE["cart"] = [line for line in cart if line[0] != sku]
                STATE["flash"] = ("ok", "Item removed.")
            elif path == "/cart/coupon":
                code = form.get("code", "").strip().upper()
                STATE["coupon_attempts"] += 1
                problem = coupon_problem(code, cart_lines()) if code else "Enter a promo code."
                if problem:
                    STATE["coupon_rejections"] += 1
                    STATE["flash"] = ("error", escape(problem))
                else:
                    replaced = STATE["coupon"] and STATE["coupon"] != code
                    STATE["flash"] = ("ok", f"Promo code {code} applied." + (f" It replaces {STATE['coupon']}." if replaced else ""))
                    STATE["coupon"] = code
            elif path == "/cart/coupon/remove":
                STATE["coupon"] = None
                STATE["flash"] = ("ok", "Promo code removed.")
            else:
                return self.send(404, {"error": "not found"})
            if STATE["coupon"] and coupon_problem(STATE["coupon"], cart_lines()):
                STATE["coupon"] = None
        self.redirect("/cart")


reset_state()

if __name__ == "__main__":
    serve_forever([(PORT, ShopHandler, HERE / "fixture")], f"shop http://127.0.0.1:{PORT}/")
