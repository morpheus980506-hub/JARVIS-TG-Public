"""Collect the decisions that make an activity-led holiday actionable."""
import re

from app.agents.intake_policy import split_clauses


BRIEF_PROMPT = ("出行安排还需要确认", "A few trip choices remain")
DELEGATE_REST = r"(?:其余|其他|剩下的|剩下|都)?(?:由)?你(?:来)?(?:安排|决定|定)|(?:you decide|up to you)(?: the rest)?"
CHOICES = {
    "lodging": (r"酒店|住宿|海景|度假村|民宿|hotel|resort|sea view", "住海边度假酒店，还是住市区？", "Beach resort or a city hotel?"),
    "transport": (r"飞机|直飞|中转|高铁|自驾|往返交通|包车|\b(?:flights?|train|drive|transfer)\b", "往返优先坐飞机还是高铁？", "Flights or rail?"),
    "dining": (r"餐厅|餐饮|海鲜|口味|清淡|当地菜|素食|\b(?:restaurants?|seafood|vegetarian|local food)\b", "吃饭有什么口味偏好？", "Any food preferences?"),
    "activities": (r"景点|日落|夜市|离岛|只泡沙滩|只想泡海滩|只安排潜水|不(?:去|玩|想)?潜水|\b(?:sunset|sights?|island hopping|no diving)\b", "还想去哪些景点，或加上日落、夜市？", "Any other sights, sunset spots, or night markets?"),
}
ALLERGY = r"过敏|allerg"
DIVE = r"潜水|\b(?:dive|diving|snorkel(?:ing)?)\b"
NO_DIVE = r"(?:不(?:去|玩|想|考虑|安排)?|取消|跳过)(?:体验)?潜水|\b(?:no|skip) diving\b"


def activity_brief_needed(brief, days):
    return bool(brief.get("diving") or (days and days > 1 and brief.get("beach")) or ("diving" in brief and brief.get("allergy")))


def answers_brief(previous: str, value: str) -> bool:
    if not previous.startswith(BRIEF_PROMPT):
        return False
    if re.search(r"[？?]|多少钱|有没有|怎么样|为什么|帮我查|查一下|how much|find me", value, re.I):
        return False
    return True


def update_activity_brief(brief, value, previous, delegates):
    if not answers_brief(previous, value) and re.search(r"[？?]|假如|如果|能不能|可不可以", value):
        return brief
    updated = dict(brief)
    clauses = split_clauses(value)
    if answers_brief(previous, value) and (delegates or any(re.fullmatch(DELEGATE_REST, clause, re.I) for clause in clauses)):
        for field in CHOICES:
            updated.setdefault(field, "")
    for clause in clauses:
        if re.search(r"海滩度假|海边度假|滨海度假|beach (?:vacation|holiday)", clause, re.I):
            updated["beach"] = clause
        if re.search(DIVE, clause, re.I):
            updated["diving"] = "" if re.search(NO_DIVE, clause, re.I) else clause
        if re.search(ALLERGY, clause, re.I):
            updated["allergy"] = clause
        if re.search(r"高度近视|high myopia", clause, re.I):
            updated["vision"] = clause
        if re.search(
            r"(?:对[^，。?？]{1,25}过敏|过敏(?:原|源)(?:是|为|有)\S|没有(?:已知|明确的?)?(?:食物|餐饮)过敏|"
            r"(?:不吃|避免|避开)(?:海鲜|虾|蟹|花生|坚果|贝类)|(?:allergic to|avoid) [\w ]+|no known food allergies)",
            clause, re.I,
        ):
            updated["allergy_detail"] = clause
        for field, (pattern, _, _) in CHOICES.items():
            if re.search(pattern, clause, re.I) and not re.fullmatch(r"酒店|住宿|往返交通|餐饮|餐厅|景点|hotel|transport|dining|sights", clause, re.I):
                updated[field] = clause
    return updated


def activity_questions(brief, days, language):
    if not activity_brief_needed(brief, days):
        return [], ""
    missing = [field for field in CHOICES if field not in brief]
    if brief.get("allergy") and not brief.get("allergy_detail"):
        missing.append("allergy_detail")
    if not missing:
        return [], ""
    english = language == "en"
    options = [CHOICES[field][2 if english else 1] for field in missing if field in CHOICES]
    lines = []
    if options:
        lines.append("\n".join(f"- {option}" for option in options))
        lines.append("Say “you decide” to leave these choices to me." if english else "没想好的可以直接说「你来安排」。")
        if not brief.get("allergy"):
            lines.append("You can also mention foods or activities you need to avoid." if english else "有需要避开的食物或活动，也可以一起说。")
    if "allergy_detail" in missing:
        lines.append("Which known allergens should I avoid when planning meals? “No known food allergies” is fine if applicable." if english else "用餐时要避开哪些已知过敏原？如果没有已知的食物过敏，也可以直接说明。")
    if brief.get("diving") and (brief.get("allergy") or brief.get("vision")):
        lines.append("I’ll keep diving tentative until suitability is confirmed." if english else "潜水先保留为待确认项目。")
    heading = BRIEF_PROMPT[english] + ("." if english else "。")
    return missing, "\n\n".join([heading, *lines])
