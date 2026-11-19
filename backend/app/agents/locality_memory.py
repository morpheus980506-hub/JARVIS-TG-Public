"""Recover a user's stated locality from the saved conversation."""
import re

from app.agents.destination import HAN
from app.agents.intake_policy import active_epoch


LOCALITY = re.compile(
    rf'(?:我(?:现在|目前|这会儿)?(?:人)?(?:就在|在|住在?)|人在|所在地(?:是|在|为))'
    rf'\s*([{HAN}]{{2,16}}?(?:新区|自治县|区|县|市)(?!区))'
    r'(?=$|[\s，,。；;、!！?？：:]|附近|这边|这里|想|要|准备|的)',
)
LEFT = re.compile(r'我(?:已经|现在|目前|早就)?(?:不在|离开)(?:这里|这边|当地|[^，。！？\n]+)')


def stated_locality(messages):
    """Only user statements count. The newest explicit update wins."""
    for message in reversed(active_epoch(messages)):
        if message.role != 'user':
            continue
        for clause in reversed(re.split(r'[，,。；;！？!\n]', message.content)):
            if match := LOCALITY.search(clause):
                return match[1]
            if LEFT.search(clause):
                return None
    return None


def amap_city(locality):
    # AMap's city filter treats 兰州新区 differently from 兰州市.
    return '兰州市' if locality in {'兰州新区', '兰州'} else locality
