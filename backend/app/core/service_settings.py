"""Local service configuration. Secrets are protected for the current Windows user."""
import ctypes
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit

STORE = Path(__file__).resolve().parents[2] / 'service-settings.bin'
CATALOG = {
    'deepseek': ('DeepSeek', [('deepseek_base_url','API 地址','API URL','url'),('deepseek_model','主模型','Primary model','text'),('deepseek_fast_model','快速模型','Fast model','text'),('deepseek_api_key','API Key','API key','secret')]),
    'amap': ('高德地图 / AMap', [('amap_api_key','Web 服务 Key','Web service key','secret'),('amap_js_api_key','地图 JS Key','Map JS key','secret'),('amap_js_security_code','地图安全密钥','Map security code','secret')]),
    'tavily': ('Tavily', [('tavily_api_key','API Key','API key','secret')]),
    'brave_search': ('Brave Search', [('brave_search_api_key','API Key','API key','secret')]),
    'exa': ('Exa', [('exa_api_key','API Key','API key','secret')]),
    'variflight': ('飞常准 / VariFlight', [('variflight_mcp_key','MCP Key','MCP key','secret')]),
    'didi': ('滴滴出行 / DiDi', [('didi_mcp_key','个人 MCP Key','Personal MCP key','secret')]),
    'fliggy': ('飞猪 / Fliggy', [('fliggy_api_key','API Key','API key','secret')]),
    'meituan': ('美团旅行 / Meituan', [('meituan_ht_token','API Token','API token','secret')]),
    'qweather': ('和风天气 / QWeather', [('qweather_api_host','API Host','API host','text'),('qweather_api_key','API Key','API key','secret')]),
    'open_meteo': ('Open-Meteo', [('open_meteo_enabled','启用天气服务','Enable weather service','boolean')]),
}


def crypt(data: bytes, decrypt=False) -> bytes:
    if sys.platform != 'win32':
        raise RuntimeError('Secure local configuration currently requires Windows')
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
    buffer=ctypes.create_string_buffer(data)
    source=Blob(len(data),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_ubyte)))
    target=Blob()
    library=ctypes.WinDLL('crypt32',use_last_error=True)
    function=library.CryptUnprotectData if decrypt else library.CryptProtectData
    function.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    function.restype=wintypes.BOOL
    if not function(ctypes.byref(source),None,None,None,None,1,ctypes.byref(target)):
        raise RuntimeError('Could not protect or read local configuration')
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.LocalFree.argtypes=[ctypes.c_void_p]
    kernel.LocalFree.restype=ctypes.c_void_p
    try:
        return ctypes.string_at(target.data,target.size)
    finally:
        kernel.LocalFree(ctypes.cast(target.data,ctypes.c_void_p))


def read_overrides(path: Path = STORE) -> dict:
    return json.loads(crypt(path.read_bytes(),True)) if path.exists() else {}


def save_overrides(values: dict,path: Path = STORE) -> None:
    encrypted=crypt(json.dumps(values,ensure_ascii=False).encode('utf-8'))
    temporary=path.with_suffix('.tmp')
    temporary.write_bytes(encrypted)
    temporary.replace(path)


def public_services(settings) -> list[dict]:
    services=[]
    for id,(name,fields) in CATALOG.items():
        public=[]
        for key,zh,en,kind in fields:
            value=getattr(settings,key)
            if kind == 'url' and value:
                url=urlsplit(value)
                value=urlunsplit((url.scheme,url.netloc.rsplit('@',1)[-1],url.path,'',''))
            public.append({'key':key,'label':zh,'label_en':en,'kind':kind,'configured':bool(value),
                           **({} if kind == 'secret' else {'value':value})})
        configured=all(field['configured'] for field in public)
        services.append({'id':id,'name':name,'configured':configured,'fields':public})
    return services
