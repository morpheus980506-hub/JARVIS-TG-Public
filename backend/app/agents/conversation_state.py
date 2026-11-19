import re
from datetime import datetime, timezone


def update_itinerary(previous: dict | None, reply: str,expected_days: int | None=None) -> dict | None:
    """Only numbered day sections become itinerary data; never infer one from prose."""
    matches = list(re.finditer(r"(?mi)^[ \t]*(?:#{1,4}[ \t]*|\*\*)?(?:D(?:ay)?[ \t]*(\d+)|第[ \t]*(\d+)[ \t]*天)[ \t｜|:：.、]*(.*)", reply))
    if not matches:
        return previous
    days = {day['day']: day for day in (previous or {}).get('days', [])}
    updated = []
    for index, match in enumerate(matches):
        number = int(match.group(1) or match.group(2))
        if not 1 <= number <= 60:
            continue
        body = reply[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(reply)]
        # General reminders after a heading are not part of the final day.
        body = re.split(r"\n\s*#{1,4}\s+|\n\s*\*\*(?:出发前|提醒|Before|Notes)", body)[0]
        items = [re.sub(r"^\s*[-*]\s+(?:\[[ xX]\]\s*)?", "", line).strip() for line in body.splitlines() if re.match(r"^\s*[-*]\s+", line)]
        if items:
            days[number] = {'day': number, 'title': match.group(3).strip().strip('*'), 'items': items}
            updated.append(number)
    if not updated:
        return previous
    # A complete new run replaces older trailing days; a single day is a patch.
    numbers = updated
    if len(numbers) == len(matches) and len(numbers) > 1 and numbers == list(range(1, max(numbers) + 1)) and (expected_days is None or max(numbers)>=expected_days):
        days = {key: value for key, value in days.items() if key in numbers}
    result={'days': sorted(days.values(), key=lambda day: day['day']), 'updated_at': datetime.now(timezone.utc).isoformat()}
    if expected_days is not None and sorted(days)!=list(range(1,expected_days+1)):result['incomplete']=True
    return result
