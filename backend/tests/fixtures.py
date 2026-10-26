from app.schemas import (CTA, Beat, BeatSheet, Character, Concept, ConceptDecision, ConceptScore, ConceptSet,
                         CreativeBrief, CriticReport, CriticScores, DialogueLine, ProductDetail, Scene, Script)

PRODUCT_HTML = """<html><head><title>Morning Brew Cold Coffee Concentrate – Brewly</title>
<meta property="og:image" content="https://cdn.example.com/products/brewly-bottle.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Morning Brew Cold Coffee Concentrate",
"brand":{"@type":"Brand","name":"Brewly"},"description":"Makes 10 cups per 250 ml bottle. 100% Arabica beans, cold-brewed for 18 hours.",
"offers":{"@type":"Offer","price":"499","priceCurrency":"INR"}}</script></head>
<body><nav>Menu</nav><h1>Morning Brew Cold Coffee Concentrate</h1>
<p>Just add milk or water. Makes 10 cups per 250 ml bottle.</p><p>100% Arabica beans, cold-brewed for 18 hours.</p>
<p>No added sugar.</p><p>Store in the fridge after opening.</p><footer>© Brewly</footer></body></html>"""

FACTS = {
    "product_name": "Morning Brew Cold Coffee Concentrate", "brand": "Brewly",
    "facts": [
        {"category": "usage", "statement": "Mix with milk or water", "quote": "Just add milk or water", "from_image": False},
        {"category": "spec", "statement": "One 250 ml bottle makes 10 cups", "quote": "Makes 10 cups per 250 ml bottle", "from_image": False},
        {"category": "ingredient", "statement": "Made with 100% Arabica beans", "quote": "100% Arabica beans", "from_image": False},
        {"category": "feature", "statement": "Cold-brewed for 18 hours", "quote": "cold-brewed for 18 hours", "from_image": False},
        {"category": "claim", "statement": "No added sugar", "quote": "No added sugar.", "from_image": False},
        {"category": "packaging", "statement": "Amber glass bottle with black cap", "quote": "BREWLY", "from_image": True},
        {"category": "certification", "statement": "Clinically proven energy", "quote": "clinically proven to boost energy", "from_image": False},
    ],
    "packaging_description": "Amber glass bottle, black screw cap, white label with BREWLY wordmark.",
    "unknowns": ["Shelf life after opening"],
}

BRIEF = CreativeBrief(
    objective="Drive first purchase among young professionals", key_message="Cafe-style cold coffee at home in 30 seconds",
    supporting_messages=["No added sugar"], audience="Working professionals 22-30",
    audience_insight="Mornings are rushed and the cafe run is a daily tax", tone="Witty, relatable",
    cta_intent="Shop now", mandatories=["Shop now on brewly.in"], exclusions=["energy drink"],
    reference_takeaways=[], assumptions=["No CTA destination given - assumed brewly.in"])


def concept(i=0):
    return Concept(title=f"The 9:58 Standup {i}", logline="She has two minutes before standup and no coffee.",
                   hook_type="relatable_moment", hook_visual="Laptop clock flips to 9:58", hook_line="Standup in two minutes. Coffee in... never?",
                   story_arc="rush -> discover -> pour -> calm on call", product_role="the 30-second fix",
                   ending_button="she unmutes, sipping", why_it_works="specific, real", risks="none")


def good_script() -> Script:
    c1 = Character(id="C1", name="Riya", role="Lead", description="27, product manager, oversized grey hoodie, hair in a clip",
                   continuity="Grey hoodie, claw clip, same mug throughout")
    return Script(
        title="The 9:58 Standup", logline="Two minutes to standup. Enough time for a real coffee.",
        concept_summary="A rushed WFH morning turns calm when cold coffee takes seconds.", hook_type="relatable_moment",
        theme="WFH mornings", audience="Young professionals", tone="Witty", characters=[c1],
        continuity=["Daylight, 10 am", "Mug: white ceramic, same in every shot", "Bottle cap removed in scene 3, stays off"],
        product_details=[ProductDetail(fact_id="F1", statement="Mix with milk or water"),
                         ProductDetail(fact_id="F2", statement="One 250 ml bottle makes 10 cups")],
        scenes=[
            Scene(number=1, start_sec=0, end_sec=2, location="Home desk", shot="ECU laptop clock",
                  visual="Laptop clock flips 9:57 to 9:58. Riya's hand freezes over an empty mug.", vo="",
                  dialogue=[DialogueLine(character_id="C1", line="Standup. Two minutes.", delivery="panicked whisper")],
                  on_screen_text="9:58 AM", sfx_music="Tick", transition="Whip pan to kitchen", characters=["C1"],
                  props=["laptop", "empty mug"], product_fact_ids=[], sync_note="She says the time as we see it"),
            Scene(number=2, start_sec=2, end_sec=6, location="Kitchen", shot="MCU handheld",
                  visual="Riya opens the fridge, grabs the Brewly bottle [USE ACTUAL PACK], label to camera.",
                  vo="", dialogue=[DialogueLine(character_id="C1", line="Okay. Plan B. Actually, plan A.", delivery="relieved")],
                  on_screen_text="", sfx_music="Fridge hum", transition="Cut on action", characters=["C1"],
                  props=["Brewly bottle"], product_fact_ids=[], sync_note="Line lands as she sees the bottle"),
            Scene(number=3, start_sec=6, end_sec=12, location="Kitchen counter", shot="Top shot, static",
                  visual="She pours the concentrate over ice, tops up with milk, stirs once.",
                  vo="Pour, add milk, done. One bottle makes 10 cups.", dialogue=[], on_screen_text="Just add milk or water",
                  sfx_music="Ice clink, pour", transition="Match cut on stir", characters=["C1"], props=["ice", "milk", "glass"],
                  product_fact_ids=["F1", "F2"], sync_note="Each verb matches the action on screen"),
            Scene(number=4, start_sec=12, end_sec=15, location="Home desk", shot="MS, push in",
                  visual="Riya sits as the call connects, sips, unmutes calmly. Bottle on desk, label to camera.",
                  vo="Shop now on brewly.in", dialogue=[], on_screen_text="Shop now on brewly.in",
                  sfx_music="Call chime", transition="", characters=["C1"], props=["glass", "Brewly bottle"],
                  product_fact_ids=[], sync_note="CTA over the calm payoff"),
        ],
        cta=CTA(line="Shop now on brewly.in", visual="Bottle on desk", on_screen_text="Shop now on brewly.in", action="Tap Shop Now"),
        production_notes=["Keep supers above the bottom 20%"])


def critic(score=5, findings=None):
    return CriticReport(scores=CriticScores(**{k: score for k in CriticScores.model_fields}),
                        findings=findings or [], verdict="Tight and specific.")


def handlers(script_fn=good_script, critic_fn=lambda **_: critic()):
    from app.ingest.product import _Extraction
    from app.pipeline import _FlagList
    return {
        "extract_product": lambda **_: _Extraction.model_validate(FACTS),
        "parse_brief": lambda **_: BRIEF,
        "reconcile": lambda **_: _FlagList(flags=[]),
        "concepts": lambda **_: ConceptSet(concepts=[concept(0), concept(1), concept(2)]),
        "choose_concept": lambda **_: ConceptDecision(scores=[ConceptScore(index=i, hook=4, brief_fit=4, originality=4,
                                                                          producibility=4, product_truth=5, rationale="")
                                                              for i in range(3)], chosen_index=1, director_notes="Cut faster."),
        "beats": lambda **_: BeatSheet(beats=[Beat(index=1, purpose="hook", start_sec=0, end_sec=2, what_happens="clock", emotional_note="panic")]),
        "write": lambda **_: script_fn(),
        "critic": critic_fn,
        "revise": lambda **_: good_script(),
    }
