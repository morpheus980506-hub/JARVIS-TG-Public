"""Route questions about JARVIS's map access using application state."""
import re

from app.agents.intake_policy import active_epoch


MAP = re.compile(r'地图|高德|\b(?:map|amap)\b', re.I)
ABILITY = re.compile(
    r'能不能|能否|能用|能查|可以|有.{0,5}能力|没法|没有|没用|不用|不能|不了|不到|无法'
    r'|\b(?:can|can.t|could|couldn.t|cannot|unable|access)\b',
    re.I,
)
QUESTION = re.compile(r'[？?]|为什么|为啥|怎么|咋|确定|真的|到底|能不能|能否|是不是|吗|\b(?:why|how|can|could|are you sure)\b', re.I)
CHALLENGE = re.compile(r'(?:你)?(?:确定|真的|为什么|为啥|怎么会|想清楚了)[吗么呢？?。！!\s]*|(?:are you sure|really|why)[?!.\s]*', re.I)
MAP_PAGE = re.compile(r'(?:地图|高德).{0,8}(?:页面|白屏|黑屏|空白|加载|打不开|不显示|没显示)|地图页', re.I)


def asks_about_map_access(messages):
    recent = active_epoch(messages)
    latest = next((message.content for message in reversed(recent) if message.role == 'user'), '')
    if MAP_PAGE.search(latest):
        return False
    if MAP.search(latest) and ABILITY.search(latest) and QUESTION.search(latest):
        return True
    if CHALLENGE.fullmatch(latest.strip()) and len(recent) >= 2:
        previous = recent[-2]
        return previous.role == 'assistant' and bool(MAP.search(previous.content) and ABILITY.search(previous.content))
    return False


def map_capability_context(configured):
    if configured:
        return ('JARVIS 的高德地图查询已配置，应用可用地址查地点和路线。此前助手说没有地图能力的内容不代表当前服务状态。'
                '设备当前位置由地图页授权获取，本轮只有拿到查询结果时才能给出已核验的里程、用时和路线。'
                '未获得结果时说明缺少的地点或本次查询状态，不要自行诊断网络、额度或权限。')
    return 'JARVIS 当前未配置高德地图查询。不得把未核验的地图路线或距离当作查询结果。'
