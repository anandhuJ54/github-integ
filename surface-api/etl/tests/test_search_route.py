"""Tests for the search-route helpers (cases from the TS behaviour)."""
from __future__ import annotations

from surfaces.etl.disco import search_route as sr


def test_stated_total_in_text_patterns():
    html = "<div>Showing 1–12 of 146,729</div><script>var x='9,999,999 agents'</script>"
    assert sr.stated_total_in_text(html) == {"total": 146729, "snippet": "Showing 1–12 of 146,729"}
    assert sr.stated_total_in_text("Showing 1&ndash;12 of 146,729")["snippet"] == (
        "Showing 1-12 of 146,729")
    r = sr.stated_total_in_text("<p>16,554 agents found near you</p>", ["agent"])
    assert r["total"] == 16554
    # category words decide: "115 offices" is not a person category's profile total
    assert sr.stated_total_in_text("<p>115 offices nationwide</p>", ["agent"]) is None
    # loosest pattern needs >= 100; years are skipped
    assert sr.stated_total_in_text("<p>5 agents</p><p>2,310 advisors</p>", ["advisor"])[
        "total"] == 2310
    assert sr.stated_total_in_text("<p>of 2024 results</p>") is None
    assert sr.stated_total_in_text("") is None


def test_needs_more_routes():
    assert sr.needs_more_routes(100, False, 1000) == {
        "more": True, "why": "best route reaches 100 of 1000 stated (10%)", "coverage": 0.1}
    assert sr.needs_more_routes(950, False, 1000)["more"] is False
    assert sr.needs_more_routes(0, False, None)["more"] is True
    assert sr.needs_more_routes(50, True, None)["why"] == (
        "best route reach 50 is a lower bound and no total is stated")
    assert sr.needs_more_routes(50, False, None)["more"] is False


PAGE = """
<form id="find" action="/search" method="get">
  <input type="hidden" name="t" value="agents">
  <label for="loc">City or ZIP</label><input id="loc" name="location" type="text">
  <button>Go</button>
</form>
<input name="lastName" placeholder="Agent name">
<input name="email" placeholder="Your email">
<input type="checkbox" name="city">
"""


def test_find_search_inputs():
    boxes = sr.find_search_inputs(PAGE, "https://ex.com/agents")
    assert [b["inputXpath"] for b in boxes] == ["//input[@id='loc']", "//input[@name='lastName']"]
    loc = boxes[0]
    assert loc["kinds"] == ["zip", "city"]
    assert loc["form"] == {"action": "https://ex.com/search", "method": "GET",
                           "inputName": "location", "fields": {"t": "agents"}}
    assert loc["submitXpath"] == ("(//form[@id='find']//button[not(@type) or @type='submit'] | "
                                  "//form[@id='find']//input[@type='submit'])[1]")
    name = boxes[1]
    assert name["kinds"] == ["name"] and name["form"] is None
    assert name["submitXpath"] == "(//input[@name='lastName']/following::button[1])[1]"
    assert sr.find_search_inputs("", "https://ex.com") == []


def test_xpath_quote():
    boxes = sr.find_search_inputs("<input name=\"o'neil search\">", "https://ex.com/")
    assert boxes[0]["inputXpath"] == "//input[@name=concat('o', \"'\", 'neil search')]"


def test_search_values_and_name_starts():
    cities = [{"city": "Houston", "state": "TX", "zip": "77002"},
              {"city": "Austin", "state": "TX", "zip": None}]
    assert sr.search_values("zip", cities, [], {}) == [["77002"]]
    assert sr.search_values("city", cities, [], {})[0] == ["Houston, TX", "Houston TX", "Houston"]
    ns = sr.name_starts(["Smith", "Smyth", "Sanchez", "Brown", "Ölund", "X"])
    assert ns["letters"] == ["S", "B", "O"]
    assert ns["bigrams"]["S"] == "Sm"
    assert sr.search_values("name", [], ns["letters"], ns["bigrams"])[0] == ["S", "Sm"]
    assert sr.search_values("name", [], ["S"], ns["bigrams"], 2) == [["Sm"]]
