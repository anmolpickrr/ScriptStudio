from app.qc.checks import check_continuity
from app.relay import LeanCTA, LeanDialogue, LeanScene, LeanScript, full_script
from app.schemas import Job, JobInputs


def _scene(n, chars, speaker=None):
    return LeanScene(number=n, start_sec=0, end_sec=3, visual="v", vo="", on_screen_text="", characters=chars,
                     dialogue=[LeanDialogue(character_id=speaker, line="hi")] if speaker else [],
                     product_fact_ids=[], sync_note="")


def test_characters_named_in_scenes_resolve_to_defined_ones():
    lean = LeanScript(title="t", logline="l", hook_type="h", tone="warm", characters=[],
                      continuity=["Creator: Indian woman 26-34, loose hair", "Bruno: the creator's real dog"],
                      scenes=[_scene(1, ["Creator", "Bruno"], "creator"), _scene(2, ["bruno"])],
                      cta=LeanCTA(line="Order now", action="tap", on_screen_text="Order"))
    job = Job(id="j1", inputs=JobInputs(product_url="https://example.com/p", client_brief="A warm launch film for pet parents."))
    script = full_script(lean, job)
    assert [c.id for c in script.characters] == ["Creator", "Bruno"]
    assert script.characters[0].description.startswith("Indian woman")
    assert script.scenes[0].dialogue[0].character_id == "Creator"
    assert script.scenes[1].characters == ["Bruno"]
    assert not [f for f in check_continuity(script) if "isn't defined" in f.message]


def test_voice_check_flags_dashes_and_stock_phrases():
    from app.qc.checks import check_language
    sc = _scene(1, [])
    sc.vo = "Elevate your mornings — unleash the perfect blend. Ever wondered why?"
    lean = LeanScript(title="t", logline="l", hook_type="h", tone="warm", characters=[], continuity=[], scenes=[sc],
                      cta=LeanCTA(line="Order now", action="tap", on_screen_text="Order"))
    found = check_language(full_script(lean, Job(id="j2", inputs=JobInputs(product_url="https://example.com/p",
                                                                          client_brief="A warm launch film for pet parents."))))
    assert any(f.check == "voice" and "dash" in f.message for f in found)
    assert any(f.check == "voice" and f.severity == "major" for f in found)
