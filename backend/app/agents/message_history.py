def model_history(messages,character_budget=24000):
    """Keep recent context bounded independently of persisted message length."""
    result=[]
    for message in reversed(messages[-16:]):
        if character_budget<=0:break
        limit=min(character_budget,8000 if message.role=='assistant' else 4000)
        content=message.content
        if len(content)>limit:
            marker='\n[Earlier reply shortened for context]'
            content=content[:limit] if limit<=len(marker) else content[:limit-len(marker)]+marker
        result.append({'role':message.role,'content':content})
        character_budget-=len(content)
    return list(reversed(result))
