import hashlib
import json
import math
import re
from time import monotonic
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from app.tools.providers.didi import DidiError


class PlaceSearch(BaseModel):
    model_config=ConfigDict(str_strip_whitespace=True)
    city:str=Field(min_length=2,max_length=80)
    keywords:str=Field(min_length=1,max_length=160)


class EstimateRequest(BaseModel):
    origin_id:str=Field(min_length=1,max_length=64)
    destination_id:str=Field(min_length=1,max_length=64)


class LinkRequest(BaseModel):
    quote_id:str=Field(min_length=1,max_length=64)
    product_category:str=Field(min_length=1,max_length=100)


def unpack(result):
    if not isinstance(result,dict):raise DidiError()
    if result.get('structuredContent') is not None:
        return result['structuredContent']
    for block in result.get('content',[]):
        if isinstance(block,dict) and block.get('type') == 'text':
            try:
                return json.loads(block['text'])
            except ValueError:
                pass
    raise DidiError()


def safe_app_link(value):
    if not isinstance(value,str) or len(value)>8192 or any(c.isspace() for c in value):
        return False
    try:url=urlsplit(value)
    except ValueError:return False
    if url.username or url.password:
        return False
    return url.scheme in {'diditaxi','didichuxing','didi'} or (url.scheme == 'https' and any(url.hostname == host or (url.hostname or '').endswith('.'+host) for host in ['didichuxing.com','xiaojukeji.com','udache.com']))


def find_app_link(result):
    def search(node):
        if safe_app_link(node):
            return node
        if isinstance(node,dict):
            for key in ['app_link','appLink','deepLink','deeplink','url','link','schema','scheme','jumpUrl']:
                if key in node:
                    found=search(node[key])
                    if found:return found
            for value in node.values():
                if isinstance(value,(dict,list)):
                    found=search(value)
                    if found:return found
        if isinstance(node,list):
            for value in node:
                found=search(value)
                if found:return found
        return None
    link=search(result.get('structuredContent'))
    if link:return link
    for block in result.get('content',[]):
        if not isinstance(block,dict):continue
        text=block.get('text','')
        if not isinstance(text,str):continue
        try:link=search(json.loads(text))
        except ValueError:link=None
        if link:return link
        for match in re.findall(r'(?:diditaxi|didichuxing|didi|https)://[^\s<>"\)]+',text):
            if safe_app_link(match):return match
    raise DidiError('invalid_link')


def build_didi_router(orchestrator):
    router=APIRouter(prefix='/api/v1/didi')
    places={}
    quotes={}

    def provider():
        service=getattr(orchestrator.tool_gateway,'didi',None)
        if service is None:
            raise HTTPException(status_code=503,detail='请先在设置 → API 接口配置滴滴个人 MCP Key')
        return service

    def tag(service):return hashlib.sha256(service.api_key.encode()).digest()

    def remember(bucket,data,ttl):
        for key in list(bucket):
            if bucket[key]['expires']<monotonic():bucket.pop(key,None)
        if len(bucket)>=256:bucket.pop(next(iter(bucket)))
        key=uuid4().hex
        bucket[key]={**data,'expires':monotonic()+ttl}
        return key

    def retrieve(bucket,key,service):
        value=bucket.get(key)
        if not value or value['expires']<monotonic() or value['credential'] != tag(service):
            raise HTTPException(status_code=410,detail='地点或报价已过期，请重新查询')
        return value

    async def call(service,name,arguments):
        try:return await service.call_tool(name,arguments)
        except DidiError as exc:
            raise HTTPException(status_code=401 if exc.code=='auth' else 502,detail='滴滴密钥验证失败，请检查配置' if exc.code=='auth' else '滴滴查询暂未完成，请稍后重试')
        except (ValueError,KeyError,TypeError):
            raise HTTPException(status_code=502,detail='滴滴返回的数据暂不可用，请稍后重试')

    @router.get('/status')
    async def status():
        return {'configured':getattr(orchestrator.tool_gateway,'didi',None) is not None,'mode':'app_handoff'}

    @router.post('/places')
    async def search_places(payload:PlaceSearch):
        service=provider()
        result=await call(service,'maps_textsearch',{'city':payload.city,'keywords':payload.keywords})
        try:
            data=unpack(result)
            if isinstance(data,dict):data=data.get('pois',data.get('data',[]))
            if not isinstance(data,list):raise DidiError()
            items=[]
            for item in data[:5]:
                if not isinstance(item,dict) or not isinstance(item.get('location'),dict):continue
                lng=float(item['location']['lng']);lat=float(item['location']['lat'])
                if not math.isfinite(lng) or not math.isfinite(lat) or not (-180<=lng<=180 and -85<=lat<=85):continue
                value={'name':str(item.get('display_name') or payload.keywords),'address':str(item.get('address_all') or item.get('address') or ''),
                       'city':str(item.get('city') or payload.city),'lng':str(lng),'lat':str(lat)}
                id=remember(places,{'place':value,'credential':tag(service)},600)
                items.append({'id':id,**value})
            if not items:raise HTTPException(status_code=404,detail='没有找到地点，请补充城市和详细地址')
            return items
        except (DidiError,ValueError,KeyError,TypeError):
            raise HTTPException(status_code=502,detail='滴滴地点数据暂不可用，请补充详细地址后重试')

    @router.post('/estimate')
    async def estimate(payload:EstimateRequest):
        service=provider()
        origin=retrieve(places,payload.origin_id,service)['place']
        destination=retrieve(places,payload.destination_id,service)['place']
        args={'from_lng':origin['lng'],'from_lat':origin['lat'],'from_name':origin['name'],
              'to_lng':destination['lng'],'to_lat':destination['lat'],'to_name':destination['name']}
        result=await call(service,'taxi_estimate',args)
        try:
            data=unpack(result)
            if not isinstance(data,dict) or not isinstance(data.get('items',[]),list):raise DidiError()
            items=[{'product_category':str(item['productCategory']),'name':str(item['productName']),'price':str(item['priceText'])} for item in data.get('items',[]) if isinstance(item,dict) and item.get('productCategory') is not None and item.get('priceText') is not None]
            if not items:raise HTTPException(status_code=404,detail='滴滴当前没有返回可用车型或报价')
            id=remember(quotes,{'origin':origin,'destination':destination,'items':items,'credential':tag(service)},120)
            return {'id':id,'origin':origin,'destination':destination,'items':items,'expires_in':120}
        except (DidiError,ValueError,KeyError,TypeError):
            raise HTTPException(status_code=502,detail='滴滴报价数据暂不可用，请重试')

    @router.post('/app-link')
    async def app_link(payload:LinkRequest):
        service=provider();quote=retrieve(quotes,payload.quote_id,service)
        if payload.product_category not in {item['product_category'] for item in quote['items']}:
            raise HTTPException(status_code=400,detail='请选择当前报价中的车型')
        origin=quote['origin'];destination=quote['destination']
        result=await call(service,'taxi_generate_ride_app_link',{'from_lng':origin['lng'],'from_lat':origin['lat'],
            'to_lng':destination['lng'],'to_lat':destination['lat'],'product_category':payload.product_category})
        try:return {'url':find_app_link(result)}
        except (DidiError,ValueError):raise HTTPException(status_code=502,detail='滴滴暂未返回可用的 App 链接，请在滴滴 App 内查询')

    return router
