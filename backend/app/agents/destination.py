"""Areas that need a concrete destination before querying city services."""
import re

# Include supplementary Han characters, while excluding reserved code points.
HAN = r"\u3400-\u4dbf\u4e00-\u9fff\U00020000-\U0002a6df\U0002a700-\U0002ebef\U00030000-\U000323af"

TRANSPORT_ANSWER = re.compile(
    r'(?:骑(?:行|车|自行车|电动(?:自行)?车|摩托车?)|自驾(?:游)?|开车|驾车|步行|走路|'
    r'坐(?:飞机|火车|高铁|地铁)|打车|自行车|电动自行车|cycling|bicycling|walking|driving)',
    re.I,
)


def invalid_route_place(value: str) -> bool:
    return bool(
        TRANSPORT_ANSWER.fullmatch(value.strip())
        or re.fullmatch(r'(?:海滩|海边|滨海|沙滩)(?:度假|休闲)?|(?:酒店|亲子)(?:度假|休闲)|(?:beach|seaside) (?:holiday|vacation)', value.strip(), re.I)
        or re.match(r'^(?:我(?:现在|目前)?在|我(?:现在|目前)?住在?)', value)
    )

# Exact matches only. A qualified place or a real, uncommon spelling is kept.
PLACE_CHOICES = {
    '通州': ('北京通州区', '江苏南通通州区'),
    '通州区': ('北京通州区', '江苏南通通州区'),
    '白云区': ('广州白云区', '贵阳白云区'),
    '朝阳区': ('北京朝阳区', '长春朝阳区'),
    '哈耳滨': ('哈尔滨',),
    '哈尔斌': ('哈尔滨',),
    '杭洲': ('杭州',),
    '嵊四县': ('嵊泗县',),
    '文州': ('温州',),
}


def place_question(place: str, field: str, language: str = 'zh') -> str | None:
    choices = PLACE_CHOICES.get(normalize_place(place))
    if not choices:
        return None
    if language == 'en':
        role = "departure city" if field == 'origin' else "destination"
        return f'Which city should I use for your {role}: {place}? Did you mean {" or ".join(choices)}? Please reply with the full place name.'
    role = '出发' if field == 'origin' else '去'
    options = '，还是'.join(choices)
    if place == '文州':
        label = "出发地" if field == 'origin' else "目的地"
        return f'{label}「{place}」是指{options}吗？请回复地名全称。'
    return f'{"你从哪个城市出发" if field == "origin" else "你想去哪个城市或目的地"}？你说的「{place}」是指{options}吗？请直接回复你要{role}的地名。'


def normalize_place(value: str) -> str:
    """Remove conversational endings while preserving the actual place name."""
    value=value.strip(' ，,。.!！?？；;')
    return re.sub(r'(?:吧|呗|呀|啊|嘛|呢|啦|好了|就行|就可以了)+$', '', value).strip()


REGIONS = {'东北', '东北地区', '华北', '华东', '华中', '华南', '西北', '西南', '江南', '长三角', '珠三角'}
REGIONS.update({'河北','山西','辽宁','吉林','黑龙江','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','海南','四川','贵州','云南','陕西','甘肃','青海','台湾','内蒙古','广西','西藏','宁夏','新疆'})


def needs_city(destination: str) -> bool:
    name=normalize_place(destination)
    return name in REGIONS or name.removesuffix('省') in REGIONS
