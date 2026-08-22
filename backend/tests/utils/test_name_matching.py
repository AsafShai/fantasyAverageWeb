from app.utils.name_matching import (
    clean_fantasy_scraped_name,
    fantasy_name_keys,
    lookup_catalog_espn_id,
)


def test_clean_fantasy_scraped_name_strips_eligibility_and_status():
    assert clean_fantasy_scraped_name("Anthony Edwards SF") == "Anthony Edwards"
    assert clean_fantasy_scraped_name("Trae Young OUT") == "Trae Young"
    assert clean_fantasy_scraped_name("SF,SG) Amen Thompson PG") == "Amen Thompson"
    assert clean_fantasy_scraped_name("SF,SG) OUT Jalen Williams PF") == "Jalen Williams"
    assert clean_fantasy_scraped_name("Joel Embiid DTD") == "Joel Embiid"
    assert clean_fantasy_scraped_name("FA Jared Butler") == "Jared Butler"
    assert clean_fantasy_scraped_name("RET Russell Westbrook III") == "Russell Westbrook III"
    assert clean_fantasy_scraped_name("Jimmy Butler III SF") == "Jimmy Butler III"


def test_clean_fantasy_scraped_name_drops_junk_rows():
    assert clean_fantasy_scraped_name("PF") == ""
    assert clean_fantasy_scraped_name("Chase-DUP Audiege-DUP") == ""
    assert clean_fantasy_scraped_name("OUT") == ""


def test_fantasy_name_keys_include_aliases():
    assert "nic claxton" in fantasy_name_keys("nicolas claxton")
    assert "nicolas claxton" in fantasy_name_keys("nic claxton")
    assert "ronald holland" in fantasy_name_keys("ron holland")


def test_lookup_catalog_espn_id_uses_aliases_and_prefix():
    names = {
        "nic claxton": 4278067,
        "ronald holland": 4683771,
        "bub carrington": 4845374,
        "anthony edwards": 4594268,
    }
    assert lookup_catalog_espn_id("nicolas claxton", names) == 4278067
    assert lookup_catalog_espn_id("ron holland", names) == 4683771
    assert lookup_catalog_espn_id("carlton carrington", names) == 4845374
    assert lookup_catalog_espn_id("anthony edwards", names) == 4594268
    assert lookup_catalog_espn_id("pf", names) is None
