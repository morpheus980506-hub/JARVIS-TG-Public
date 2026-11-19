"""Ground hotel dates in user input or confirmed facts, never in model output alone."""
import re
from datetime import date, datetime, timedelta, timezone

from app.agents.intake_policy import normalized_input, protected_fields
from app.agents.planner import parse_people


def grounded_stay_dates(messages,facts):
    dates=set();nights=[]
    if facts.get('start_date'):
        dates.add(date.fromisoformat(facts['start_date']))
    pattern=r'(?<![\d./-])(?:(\d{4})[年./-])?(\d{1,2})[月./-](\d{1,2})(?:日|号)?(?!\d|\s*(?:元|人|天))'
    for message in messages:
        if message.role!='user':continue
        value=normalized_input(message.content)
        if 'start_date' in protected_fields(value):continue
        if re.search(r'日期|入住|退房',value) and re.search(r'未定|没定|待定|不确定',value):
            dates.clear();nights.clear();continue
        if re.search(r'改|换|instead|change|revise',value,re.I) and re.search(pattern,value):
            dates.clear();nights.clear()
        anchor=(message.created_at or datetime.now(timezone.utc)).astimezone(timezone(timedelta(hours=8))).date()
        date_anchor=anchor
        for match in re.finditer(pattern,value):
            year,month,day=match.groups();parsed=None
            for candidate_year in [int(year)] if year else range(date_anchor.year,min(10000,date_anchor.year+9)):
                try:possible=date(candidate_year,int(month),int(day))
                except ValueError:continue
                if year or possible>=date_anchor:parsed=possible;break
            if parsed is None:continue
            dates.add(parsed)
            date_anchor=parsed
            # Compact range: 2099年11月20日至22日.
            end=re.match(r'\s*(?:至|到|[-~])\s*(\d{1,2})(?:日|号)(?!\d)',value[match.end():])
            if end:
                try:
                    last=date(parsed.year,parsed.month,int(end.group(1)))
                    if last<parsed:
                        last=date(parsed.year+(parsed.month==12),parsed.month%12+1,int(end.group(1)))
                    dates.add(last)
                except ValueError:pass
        for label,offset in [('大后天',3),('后天',2),('明天',1),('今晚',0),('今天',0),('tomorrow',1),('today',0)]:
            if re.search(label,value,re.I):
                try:dates.add(anchor+timedelta(days=offset))
                except OverflowError:pass
                break
        for number in re.findall(r'([一二两三四五六七八九十\d]+)\s*(?:晚|nights?\b)',value,re.I):
            try:nights.append(parse_people(number))
            except ValueError:pass
    return dates,nights


def stay_is_grounded(check_in,check_out,messages,facts):
    dates,nights=grounded_stay_dates(messages,facts)
    return check_in in dates and (check_out in dates or (check_out-check_in).days in nights)
