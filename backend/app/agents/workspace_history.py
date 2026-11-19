"""Bounded semantic undo; operational tokens and chat messages never move backwards."""
from copy import deepcopy
from app.agents.intake_policy import MAX_REVISIONS

WORKSPACE_FIELDS=('requirements','budget_limit','trip_id','itinerary','selections','plan_feedback','weather_review','route_review','travel_results')


def snapshot_workspace(metadata):
    return deepcopy({key:metadata[key] for key in WORKSPACE_FIELDS if key in metadata})


def restore_workspace(metadata,snapshot):
    for key in WORKSPACE_FIELDS:
        if key in snapshot:metadata[key]=deepcopy(snapshot[key])
        else:metadata.pop(key,None)


def remember_workspace(metadata,snapshot):
    metadata['workspace_revisions']=[*metadata.get('workspace_revisions',[]),snapshot][-MAX_REVISIONS:]


def facts_changed(before,after):
    defaults={'preferences':[],'hard_constraints':[],'planning_status':'active','pending_places':{}}
    return any(before.get(key,defaults.get(key))!=after.get(key,defaults.get(key)) for key in
               ('origin','destination','start_date','days','travelers','budget_cny',*defaults))
