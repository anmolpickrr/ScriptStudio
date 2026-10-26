from app.ingest.product import analyse_product, parse_html, quote_in_source
from app.llm import FakeLLM
from tests.fixtures import PRODUCT_HTML, handlers


def test_parse_html_pulls_jsonld_meta_and_strips_chrome():
    src = parse_html("https://brewly.in/products/morning-brew", PRODUCT_HTML)
    assert src.structured[0]["name"] == "Morning Brew Cold Coffee Concentrate"
    assert "https://cdn.example.com/products/brewly-bottle.jpg" in src.image_urls
    assert "Menu" not in src.text and "Just add milk or water" in src.text


def test_quote_matching_is_whitespace_and_case_tolerant_but_not_fuzzy():
    src = "Makes 10 cups per 250 ml bottle."
    assert quote_in_source("makes 10 cups  per 250 ML bottle", src)
    assert not quote_in_source("makes 12 cups per 250 ml bottle", src)


def test_unverifiable_facts_are_withheld_and_flagged():
    page = parse_html("https://brewly.in/products/morning-brew", PRODUCT_HTML)
    dossier, flags = analyse_product(page.url, FakeLLM(handlers()), page=page)
    by_stmt = {f.statement: f for f in dossier.facts}
    assert by_stmt["One 250 ml bottle makes 10 cups"].verified
    assert by_stmt["Amber glass bottle with black cap"].verified          # image evidence ok for packaging
    assert not by_stmt["Clinically proven energy"].verified               # quote not on the page
    assert any("withheld" in f.message for f in flags)
    assert all(f.id.startswith("F") for f in dossier.facts)
