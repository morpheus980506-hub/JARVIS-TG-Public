type Text = [string,string]
export interface ServiceGuide {name:string;url:string;steps:Text[];check:Text;help:Text}
export const serviceGuides:Record<string,ServiceGuide>={
  deepseek:{name:'DeepSeek',url:'https://api-docs.deepseek.com/',steps:[
    ['登录 DeepSeek 开放平台，创建 API Key。','Sign in to the DeepSeek platform and create an API key.'],
    ['API 地址填写 https://api.deepseek.com；API Key 粘贴刚申请的密钥。','Use https://api.deepseek.com as the API URL and paste your new API key.'],
    ['主模型和快速模型填写账户可用的模型名称，以官方模型列表为准。保存配置。','Enter primary and fast model names available to your account, using the official model list, then save.'],
  ],check:['回到主聊天发一条旅行咨询，确认收到回复。','Send a travel question in chat and check for a reply.'],help:['失败时检查密钥、账户额度及模型名称。快速模型不可用时，会尝试同一 API 上的主模型。','Check the key, account credits and model names. If the fast model is unavailable, JARVIS tries the primary model on the same API.']},
  tavily:{name:'Tavily',url:'https://help.tavily.com/articles/9170796666-how-can-i-create-an-api-key',steps:[
    ['登录 Tavily 平台，在 API Keys 区域获取或创建密钥。','Sign in to the Tavily platform and obtain or create a key under API Keys.'],
    ['在此服务的 API Key 字段粘贴密钥并保存。','Paste it into this service’s API Key field and save.'],
  ],check:['在聊天里询问某个目的地近期的旅行信息，并查看返回的资料来源。','Ask for recent travel information about a destination and inspect the returned sources.'],help:['没有联网结果时检查密钥额度与网络；普通聊天能回复不代表联网搜索已经可用。','Check search credits and connectivity. A normal chat reply alone does not verify web search.']},
  brave_search:{name:'Brave Search',url:'https://api-dashboard.search.brave.com/documentation/quickstart',steps:[
    ['登录 Brave Search API 控制台，开通搜索方案并创建密钥。','Sign in to the Brave Search API dashboard, activate a search plan, and create a key.'],
    ['在 Brave Search 的 API Key 字段填写密钥并保存。','Paste the key into the Brave Search API Key field and save.'],
  ],check:['打开主聊天的「联网搜索」，查看结果上方显示的搜索平台。也可在服务状态里检查 Brave Search。','Open Web search in chat and check the provider above the results. You can also check Brave Search in the service status.'],help:['搜索会优先用 Tavily，缺少结果或请求失败时尝试下一个已配置的平台。','Search tries Tavily first and moves on to the next configured provider when a request fails or returns no results.']},
  exa:{name:'Exa',url:'https://exa.ai/docs/reference/search',steps:[
    ['登录 Exa 控制台，创建 API Key。','Sign in to the Exa dashboard and create an API key.'],
    ['在 Exa 的 API Key 字段填写密钥并保存。','Paste the key into the Exa API Key field and save.'],
  ],check:['打开主聊天的「联网搜索」，查看结果上方显示的搜索平台。也可在服务状态里检查 Exa。','Open Web search in chat and check the provider above the results. You can also check Exa in the service status.'],help:['当 Tavily 和 Brave Search 未配置或没有可用结果时，会尝试 Exa。','Exa is tried when Tavily and Brave Search are unconfigured or yield no usable results.']},
  amap:{name:'高德地图 / AMap',url:'https://lbs.amap.com/api/javascript-api/guide/abc/prepare',steps:[
    ['登录高德开放平台，在应用管理中创建应用。','Sign in to the AMap developer platform and create an application.'],
    ['添加“Web 服务”类型的 Key，填入本页“Web 服务 Key”，用于地点和路线查询。','Create a Web Service key and enter it under Web service key for places and routes.'],
    ['另建“Web 端（JS API）”类型的 Key，将 Key 和对应的安全密钥分别填入“地图 JS Key”和“地图安全密钥”。','Create a separate Web (JS API) key; enter it and its matching security code in Map JS key and Map security code.'],
    ['保存后刷新页面；如设置了域名或 IP 限制，需允许实际访问地址。','Save and reload the page. If domain or IP restrictions are enabled, allow the actual access address.'],
  ],check:['打开地图，搜索一个具体地点，再查询一条路线；底图能显示不代表路线权限已开通。','Open the map, search for a specific place, then request a route. A visible map alone does not verify route permissions.'],help:['不要把两种 Key 混用；安全密钥必须与 JS Key 配对。特殊车型可能需要单独开通权限。','Do not swap the two key types. The security code must match the JS key; special vehicle routes may need separate access.']},
  variflight:{name:'飞常准 / VariFlight',url:'https://mcp.variflight.com/',steps:[
    ['登录飞常准 AI 开放平台，按平台指引申请所需 MCP 服务权限。','Sign in to the VariFlight AI platform and apply for the MCP services you need.'],
    ['复制服务的 MCP Key，粘贴到本页“MCP Key”字段，保存。','Copy the service MCP key into this page’s MCP Key field and save.'],
  ],check:['在聊天查询具体机场之间、具体日期的航班，查看是否返回班次与机场。','Ask in chat for flights between specific airports on a specific date and check for services and airports.'],help:['航班、票价和铁路工具的权限可能不同，按官方控制台实际授权检查。','Flight, fare and rail tools may require different access; check your actual console permissions.']},
  didi:{name:'滴滴出行 / DiDi',url:'https://mcp.didichuxing.com/api',steps:[
    ['登录滴滴 MCP 平台，打开控制台，按指引获取个人 API Key / MCP Key。','Sign in to the DiDi MCP platform, open its console and obtain a personal API / MCP key.'],
    ['将完整密钥粘贴到本页“个人 MCP Key”并保存。无需手动填写 MCP 地址。','Paste the full key into Personal MCP key and save. No manual MCP URL is needed.'],
  ],check:['地图 → 出租车 → 滴滴查价，搜索并确认上下车地点，查看车型预估。','Go to Map → Taxi → DiDi fares, search and confirm pickup/drop-off places, then check estimates.'],help:['这里不创建订单；实际叫车由你在滴滴 App 确认。密钥关联账户，请勿公开分享。','This app does not create orders. Confirm actual rides in the DiDi app. Keep account-linked keys private.']},
  fliggy:{name:'飞猪 / Fliggy',url:'https://flyai.open.fliggy.com/console',steps:[
    ['登录飞猪 AI 开放平台，在控制台按指引获取正式 API Key。','Sign in to the Fliggy AI platform and follow its console instructions to obtain an API key.'],
    ['粘贴到本页 API Key 字段并保存，无需安装或手填客户端命令。','Paste it into API Key and save. No client installation or command entry is needed here.'],
  ],check:['在主聊天里请 JARVIS 用飞猪查具体城市和日期的酒店，查看平台返回的候选。','In chat, ask JARVIS to search Fliggy for hotels with a city and dates, then check the results.'],help:['如果结果为空，核对平台授权、日期和查询条件；起价不等于最终成交价。','For empty results, check access, dates and search details. Starting prices are not final prices.']},
  meituan:{name:'美团旅行 / Meituan',url:'https://developer.meituan.com/zh/v2/dev/token',steps:[
    ['登录美团开发者平台，按官方 Token 页面指引获取旅行服务可用的 API Token。','Sign in to the Meituan developer platform and follow the official Token page to obtain a token usable for travel services.'],
    ['粘贴到本页 API Token 字段并保存。','Paste it into API Token and save.'],
  ],check:['在主聊天里请 JARVIS 用美团查具体城市和日期的酒店，查看平台返回的候选。','In chat, ask JARVIS to search Meituan for hotels with a city and dates, then check the results.'],help:['Token 无效或权限不足时，回到官方平台检查授权；正文结果和可选择卡片可能有所不同。','For an invalid token or access error, check platform authorization. Text results and selectable cards can differ.']},
  qweather:{name:'和风天气 / QWeather',url:'https://dev.qweather.com/docs/configuration/api-host/',steps:[
    ['登录和风天气控制台，创建项目及 API KEY 凭据；本应用当前填写 API Key，不填写 JWT 私钥。','Sign in to the QWeather console and create a project and API KEY credential. This app uses an API key, not a JWT private key.'],
    ['从控制台设置复制个人 API Host，填入 API Host 字段；只填主机名，不带 https:// 或路径。','Copy your personal API Host from console settings. Enter only the hostname, without https:// or a path.'],
    ['将 API Key 填入对应字段，保存配置。','Enter the API key in its field and save.'],
  ],check:['生成具体城市的行程后更新天气，查看返回资料的来源与时间。','After generating a city itinerary, refresh weather and inspect its source and timestamp.'],help:['Host 和 Key 需来自对应账户；系统可能使用 Open-Meteo 备用结果，应看实际来源。','Use the matching account Host and key. Open-Meteo fallback may be used; check the actual source.']},
  open_meteo:{name:'Open-Meteo',url:'https://open-meteo.com/en/docs',steps:[
    ['本应用现有接入不要求填写密钥，只需打开“启用天气服务”并保存。','The current integration needs no key. Turn on Enable weather service and save.'],
    ['打开地图图层 → 天气预报，选择降水、风速或云量。','Open Map layers → Weather forecast and select precipitation, wind or cloud cover.'],
  ],check:['查看地图是否出现天气颜色、图例和预报时间；无覆盖区域不应当作零值。','Check weather colors, legend and forecast time. Missing coverage does not mean zero.'],help:['地图气象是测试功能；公开服务的使用条件与限额以官方说明为准。','Map weather is experimental. Follow the public service’s official terms and limits.']},
}
