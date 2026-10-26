from app.house_format import DEFAULT_FORMAT
from app.ingest.product import analyse_product, parse_html
from app.llm import FakeLLM
from app.qc.checks import run_checks
from app.schemas import DialogueLine, JobInputs
from tests.fixtures import BRIEF, PRODUCT_HTML, good_script, handlers

INPUTS = JobInputs(product_url="https://brewly.in/products/morning-brew", client_brief="Launch film for young professionals who need quick coffee", platform="instagram_reels",
                   duration_sec=15, mandatories=["Shop now on brewly.in"], exclusions=["energy drink"])


def dossier():
    page = parse_html(INPUTS.product_url, PRODUCT_HTML)
    return analyse_product(page.url, FakeLLM(handlers()), page=page)[0]


def checks_of(script):
    return run_checks(script, INPUTS, dossier(), BRIEF, DEFAULT_FORMAT)


def test_good_script_has_no_blocking_findings():
    bad = [f for f in checks_of(good_script()) if f.severity in ("blocker", "major")]
    assert bad == [], bad


def test_invented_number_and_unverified_fact_are_blockers():
    s = good_script()
    s.scenes[2].vo = "One bottle makes 30 cups."
    s.scenes[2].product_fact_ids = ["F7"]  # the unverified "clinically proven" fact
    found = checks_of(s)
    assert any(f.check == "product_accuracy" and "30" in f.message for f in found)
    assert any("unverified fact F7" in f.message for f in found)


def test_claim_language_without_evidence():
    s = good_script()
    s.scenes[2].vo = "Clinically proven to wake you up."
    assert any(f.check == "product_accuracy" and "clinically" in f.message for f in checks_of(s))


def test_timing_overflow_and_gaps():
    s = good_script()
    s.scenes[0].dialogue = [DialogueLine(character_id="C1", line=" ".join(["word"] * 20), delivery="")]
    s.scenes[2].start_sec = 7
    found = checks_of(s)
    assert any(f.check == "timing" and f.scene == 1 for f in found)
    assert any(f.check == "structure" and "Gap/overlap" in f.message for f in found)


def test_fake_visuals_badges_and_undefined_characters():
    s = good_script()
    s.scenes[1].visual += " A glowing aura surrounds the bottle next to a gold award badge."
    s.scenes[3].characters.append("C9")
    found = checks_of(s)
    assert any(f.check == "authenticity" and "aura" in f.message for f in found)
    assert any(f.check == "continuity" and "C9" in f.message for f in found)


def test_mandatories_exclusions_and_cta():
    s = good_script()
    s.scenes[3].vo = "It's basically an energy drink."
    s.scenes[3].on_screen_text = ""
    found = checks_of(s)
    assert any("Mandatory not included" in f.message for f in found)
    assert any("excluded" in f.message for f in found)
    assert any(f.check == "cta" for f in found)


def test_story_times_are_not_treated_as_claims():
    s = good_script()
    s.scenes[0].dialogue[0].line = "It's 9 am. Standup."
    assert not any(f.check == "product_accuracy" for f in checks_of(s))
