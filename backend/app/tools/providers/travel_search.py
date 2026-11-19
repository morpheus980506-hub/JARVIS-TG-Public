"""Read-only searches through pinned, official travel clients. No order tools."""
import asyncio
import json
import os
import shutil
import subprocess
import re
from time import monotonic
from uuid import uuid4
from threading import Lock
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

CLIENT_ROOT=Path(__file__).resolve().parents[4]/'tools'/'travel-clients'
CLIENTS={
    'fliggy':('fliggy_api_key','FLYAI_API_KEY','@fly-ai/flyai-cli/dist/flyai-bundle.cjs'),
    'meituan':('meituan_ht_token','MEITUAN_HT_TOKEN','@meituan-travel/ht-ai/dist/index.js'),
}


class TravelSearchError(RuntimeError):
    def __init__(self,code):
        self.code=code
        super().__init__(code)


def safe_travel_link(value,provider):
    if not isinstance(value,str) or len(value)>8192 or any(c.isspace() for c in value):return None
    try:url=urlsplit(value)
    except ValueError:return None
    if provider=='meituan' and url.scheme=='http' and url.netloc.lower()=='dpurl.cn':
        url=url._replace(scheme='https');value=url.geturl()
    hosts={'fliggy':['fliggy.com','feizhu.com','alitrip.com','taobao.com','tb.cn'],
           'meituan':['meituan.com','dianping.com','dpurl.cn']}.get(provider,[])
    if url.scheme=='https' and not url.username and not url.password and any(url.hostname==host or (url.hostname or '').endswith('.'+host) for host in hosts):return value
    return None


def parse_fliggy(raw):
    try:body=json.loads(raw)
    except ValueError:raise TravelSearchError('invalid_response') from None
    if not isinstance(body,dict) or 'data' not in body:raise TravelSearchError('invalid_response')
    if body.get('status') not in (None,0,'0'):raise TravelSearchError('upstream')
    data=body.get('data',{})
    if not isinstance(data,dict) or not isinstance(data.get('itemList',[]),list):raise TravelSearchError('invalid_response')
    items=[]
    for item in data.get('itemList',[])[:20]:
        info=item.get('info') if isinstance(item,dict) else None
        if not isinstance(info,dict) or not info.get('title'):continue
        tags=info.get('tags',[])
        items.append({'title':str(info['title'])[:500], 'price_text':str(info['price'])[:100] if info.get('price') is not None else '',
                      'tags':[str(tag)[:100] for tag in tags[:8]] if isinstance(tags,list) else [],
                      'url':safe_travel_link(info.get('jumpUrl'),'fliggy')})
    return {'items':items,'text':'','notice':str(body.get('systemMessage') or '')[:2000]}


class TravelSearchGateway:
    def __init__(self,settings,runner=None):
        self.settings=settings
        self.runner=runner or subprocess.run
        self.locks={name:asyncio.Semaphore(2) for name in CLIENTS}
        self.candidates={}
        self._candidate_lock=Lock()

    def status(self):
        return [{'id':name,'configured':bool(getattr(self.settings,field)),
                 'client_installed':bool(shutil.which('node') and (CLIENT_ROOT/'node_modules'/path).is_file())}
                for name,(field,_,path) in CLIENTS.items()]

    def _search(self,provider,city,query):
        if provider not in CLIENTS:raise TravelSearchError('unsupported')
        field,env_name,path=CLIENTS[provider]
        key=getattr(self.settings,field)
        if not key:raise TravelSearchError('not_configured')
        node=shutil.which('node');entry=CLIENT_ROOT/'node_modules'/path
        if not node or not entry.is_file():raise TravelSearchError('client_missing')
        # Only a fixed search command is callable; query is a separate argument, never shell code.
        args=([node,str(entry),'keyword-search','--query',f'{city}：{query}'] if provider=='fliggy' else
              [node,str(entry),'query','--city',city,'--query',query,'--origin-query',query])
        environment={k:v for k,v in os.environ.items() if k.upper() in {
            'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','LANG','LC_ALL','TZ',
            'HTTP_PROXY','HTTPS_PROXY','NO_PROXY'}}
        environment[env_name]=key
        try:
            process=self.runner(args,cwd=CLIENT_ROOT,env=environment,shell=False,capture_output=True,
                                timeout=160 if provider=='meituan' else 50,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        except subprocess.TimeoutExpired:raise TravelSearchError('timeout') from None
        except OSError:raise TravelSearchError('client_missing') from None
        if process.returncode:
            # Never return stderr: clients may include credentials or signed request URLs.
            raise TravelSearchError('auth' if process.returncode==3 else 'upstream')
        if len(process.stdout)>2_000_000:raise TravelSearchError('invalid_response')
        raw=process.stdout.decode('utf-8',errors='replace').strip().replace(key,'[redacted]')
        if not raw:raise TravelSearchError('empty')
        if provider=='fliggy':content=parse_fliggy(raw)
        else:
            items=[]
            for line in raw.splitlines():
                match=re.search(r'\[([^\n]+?)\]\((https?://[^\s)]+)\)(.*)',line)
                if not match or match.group(1).startswith('!'):continue
                url=safe_travel_link(match.group(2),provider)
                if not url:continue
                price=re.search(r'[¥￥]\s*\d+(?:\.\d+)?(?:起)?(?:/晚)?',match.group(3))
                title=re.sub(r'[*\\]','',match.group(1)).strip()
                if title and title not in {'查看详情','点击查看','预订','查看酒店'}:
                    items.append({'title':title[:500],'price_text':price.group(0) if price else '', 'tags':[],'url':url})
            content={'text':raw[:60000],'items':items[:20],'notice':''}
        with self._candidate_lock:
            for candidate in list(self.candidates):
                if self.candidates[candidate]['expires']<monotonic():self.candidates.pop(candidate,None)
            for item in content['items']:
                candidate=uuid4().hex
                item['candidate_id']=candidate
                self.candidates[candidate]={'provider':provider,'city':city,**item,'expires':monotonic()+1800}
            while len(self.candidates)>500:self.candidates.pop(next(iter(self.candidates)))
        return {'provider':provider,**content,'queried_at':datetime.now(timezone.utc).isoformat()}

    def candidate(self,id):
        with self._candidate_lock:
            item=self.candidates.get(id)
            if not item or item['expires']<monotonic():raise TravelSearchError('expired')
            return {key:value for key,value in item.items() if key!='expires'}

    async def search(self,provider,city,query):
        if provider not in self.locks:raise TravelSearchError('unsupported')
        async with self.locks[provider]:
            task=asyncio.create_task(asyncio.to_thread(self._search,provider,city,query))
            try:return await asyncio.shield(task)
            except asyncio.CancelledError:
                # Keep the slot until the bounded subprocess finishes; repeated Stop
                # clicks must not leave unlimited CLI processes running in the background.
                try:await task
                except Exception:pass
                raise
