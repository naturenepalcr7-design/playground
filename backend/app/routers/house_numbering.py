import json, math, os
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pyproj import Transformer
from shapely import from_wkb
from shapely.geometry import shape
from shapely.ops import transform, linemerge
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import get_current_user, require_role
from app.database import get_db
from app.helpers import log_audit
from app.models import User, UserRole, VectorFeature, VectorLayer, AuditLog

router=APIRouter(prefix="/api/v1",tags=["House Numbering"])
METRIC_SRID=int(os.getenv("HOUSE_NUMBERING_METRIC_SRID","32645"))
POLICY={"orientation_method":"canonical_endpoint","numbering_origin":1,"spacing_m":10.0,"rounding_method":"round","odd_even_convention":"left_odd_right_even","branch_format":"{road}/{number}","duplicate_policy":"increment_suffix","status_label":"Prototype / Pending Municipal Confirmation"}

class Assignment(BaseModel):
    building_id:int
    road_id:int
    source_point:Optional[Dict[str,Any]]=None
    source_type:str="centroid"
    distance_m:Optional[float]=None
    confidence:Optional[float]=None
    candidate_count:int=1
    assignment_status:str="PROPOSED"
class AssignmentPreview(BaseModel):
    building_layer_id:int
    road_layer_id:int
    gate_layer_id:Optional[int]=None
    ward_feature_id:Optional[int]=None
    gate_radius_m:float=80
    ambiguity_radius_m:float=15
    limit:int=Field(10000,gt=0,le=50000)
class AssignmentCommit(BaseModel):
    building_layer_id:int
    road_layer_id:int
    items:list[Assignment]=[]
class NumberPreview(BaseModel):
    building_layer_id:int
    road_layer_id:int
    ward_feature_id:Optional[int]=None
    policy_overrides:Dict[str,Any]={}
    limit:int=Field(10000,gt=0,le=20000)
class NumberCommit(BaseModel): run_id:int

async def layer(db,id,label):
    x=(await db.execute(select(VectorLayer).where(VectorLayer.id==id))).scalar_one_or_none()
    if not x: raise HTTPException(404,f"{label} layer not found")
    return x

async def catalog(db):
    rows=(await db.execute(select(VectorLayer).order_by(VectorLayer.name))).scalars().all()
    out={"wards":[],"roads":[],"buildings":[],"gates":[],"all_layers":[]}
    for l in rows:
        c=int((await db.execute(select(func.count(VectorFeature.id)).where(VectorFeature.layer_id==l.id))).scalar() or 0)
        t=l.geometry_type.value if hasattr(l.geometry_type,"value") else str(l.geometry_type)
        x={"id":l.id,"name":l.name,"geometry_type":t,"feature_count":c,"is_global":l.is_global,"project_id":l.project_id}
        out["all_layers"].append(x); n=(l.name or "").lower()
        if "ward" in n or "वडा" in n: out["wards"].append(x)
        if any(k in n for k in ("road","street","route","sadak","बाटो","सडक")): out["roads"].append(x)
        if any(k in n for k in ("building","house","भवन","घर")): out["buildings"].append(x)
        if any(k in n for k in ("gate","entrance","प्रवेश")): out["gates"].append(x)
    return out

async def fc(db,layer_id,ward,limit):
    w="f.layer_id=:lid"; p={"lid":layer_id,"lim":limit}
    if ward: w+=" AND ST_Intersects(f.geom,(SELECT geom FROM vector_features WHERE id=:wid))"; p["wid"]=ward
    rows=(await db.execute(text("SELECT f.id,f.properties,ST_AsGeoJSON(f.geom) geometry FROM vector_features f WHERE "+w+" ORDER BY f.id LIMIT :lim"),p)).mappings().all()
    return {"type":"FeatureCollection","features":[{"type":"Feature","id":r["id"],"properties":r["properties"] or {},"geometry":json.loads(r["geometry"])} for r in rows if r["geometry"]]}

@router.get("/house-numbering/health")
async def hn_health(): return {"status":"ok","service":"house-numbering","api_version":"v1"}
@router.get("/house-numbering/catalog")
async def hn_catalog(db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)): return await catalog(db)
@router.get("/wards")
async def wards(db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
    c=await catalog(db); out=[]
    for l in c["wards"]:
        rows=(await db.execute(text("SELECT id,properties FROM vector_features WHERE layer_id=:id ORDER BY id"),{"id":l["id"]})).mappings().all()
        for r in rows: out.append({"id":r["id"],"layer_id":l["id"],"name":str((r["properties"] or {}).get("ward_no") or (r["properties"] or {}).get("ward") or (r["properties"] or {}).get("name") or "Ward "+str(r["id"])),"properties":r["properties"] or {}})
    return out
@router.get("/roads")
async def roads(layer_id:Optional[int]=None,ward_feature_id:Optional[int]=None,limit:int=5000,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
    layer_id=layer_id or ((await catalog(db))["roads"] or [{}])[0].get("id")
    return await fc(db,layer_id,ward_feature_id,limit) if layer_id else {"type":"FeatureCollection","features":[]}
@router.get("/buildings")
async def buildings(layer_id:Optional[int]=None,ward_feature_id:Optional[int]=None,limit:int=5000,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
    layer_id=layer_id or ((await catalog(db))["buildings"] or [{}])[0].get("id")
    return await fc(db,layer_id,ward_feature_id,limit) if layer_id else {"type":"FeatureCollection","features":[]}
@router.get("/gates")
async def gates(layer_id:Optional[int]=None,ward_feature_id:Optional[int]=None,limit:int=5000,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
    layer_id=layer_id or ((await catalog(db))["gates"] or [{}])[0].get("id")
    return await fc(db,layer_id,ward_feature_id,limit) if layer_id else {"type":"FeatureCollection","features":[]}

@router.get("/dashboard/summary")
async def summary(building_layer_id:int,road_layer_id:int,ward_feature_id:Optional[int]=None,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
    w="b.layer_id=:b"; p={"b":building_layer_id,"r":road_layer_id,"w":ward_feature_id}
    if ward_feature_id:w+=" AND ST_Intersects(b.geom,(SELECT geom FROM vector_features WHERE id=:w))"
    buildings=int((await db.execute(text("SELECT count(*) FROM vector_features b WHERE "+w),p)).scalar() or 0)
    roads=int((await db.execute(text("SELECT count(*) FROM vector_features WHERE layer_id=:r"),p)).scalar() or 0)
    assigned=int((await db.execute(text("SELECT count(*) FROM building_road_assignments a JOIN vector_features b ON b.id=a.building_feature_id WHERE a.road_feature_id IS NOT NULL AND "+w),p)).scalar() or 0)
    numbered=int((await db.execute(text("SELECT count(*) FROM house_numbers h JOIN vector_features b ON b.id=h.building_feature_id WHERE h.status='COMMITTED' AND "+w),p)).scalar() or 0)
    review=int((await db.execute(text("SELECT count(*) FROM building_road_assignments a JOIN vector_features b ON b.id=a.building_feature_id WHERE a.assignment_status='REVIEW' AND "+w),p)).scalar() or 0)
    return {"buildings":buildings,"roads":roads,"assigned":assigned,"numbered":numbered,"review":review,"unassigned":max(0,buildings-assigned),"assignment_rate":round(100*assigned/buildings,1) if buildings else 0,"numbering_rate":round(100*numbered/buildings,1) if buildings else 0}

@router.post("/assignments/preview")
async def assignment_preview(x:AssignmentPreview,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
    await layer(db,x.building_layer_id,"Building"); await layer(db,x.road_layer_id,"Road")
    if x.gate_layer_id: await layer(db,x.gate_layer_id,"Gate")
    wc=""; p={"b":x.building_layer_id,"r":x.road_layer_id,"g":x.gate_layer_id,"w":x.ward_feature_id,"gr":x.gate_radius_m,"ar":x.ambiguity_radius_m,"lim":x.limit}
    if x.ward_feature_id: wc="AND ST_Intersects(b.geom,(SELECT geom FROM vector_features WHERE id=:w))"
    q=text("""WITH bs AS (SELECT b.id,ST_PointOnSurface(b.geom) pt FROM vector_features b WHERE b.layer_id=:b """+wc+""" ORDER BY b.id LIMIT :lim)
    SELECT bs.id building_id,COALESCE(g.id,0) gate_id,COALESCE(g.pt,bs.pt) source,
    r.id road_id,ST_Distance(ST_Transform(r.geom,:srid),ST_Transform(COALESCE(g.pt,bs.pt),:srid)) distance_m
    FROM bs LEFT JOIN LATERAL(SELECT id,ST_PointOnSurface(geom) pt FROM vector_features WHERE :g IS NOT NULL AND layer_id=:g AND ST_DWithin(ST_Transform(geom,:srid),ST_Transform(bs.pt,:srid),:gr) ORDER BY geom<->bs.pt LIMIT 1)g ON TRUE
    LEFT JOIN LATERAL(SELECT id,geom FROM vector_features WHERE layer_id=:r ORDER BY geom<->COALESCE(g.pt,bs.pt) LIMIT 1)r ON TRUE""").bindparams(srid=METRIC_SRID)
    rows=(await db.execute(q,p)).mappings().all(); out=[]
    for r in rows:
        d=float(r["distance_m"]) if r["distance_m"] is not None else None
        out.append({"building_id":r["building_id"],"road_id":r["road_id"],"source_type":"gate" if r["gate_id"] else "centroid","source_point":json.loads(r["source"].__str__()) if False else None,"distance_m":round(d,2) if d is not None else None,"candidate_count":1,"confidence":.95 if d is not None and d<=15 else .75,"assignment_status":"REVIEW" if d is None or d>50 else "PROPOSED"})
    return {"items":out,"count":len(out),"metric_srid":METRIC_SRID}

@router.post("/assignments/commit")
async def assignment_commit(x:AssignmentCommit,db:AsyncSession=Depends(get_db),user:User=Depends(require_role(UserRole.GisAdmin,UserRole.Validator))):
    n=0
    for a in x.items:
        if not a.road_id: continue
        await db.execute(text("""INSERT INTO building_road_assignments(building_feature_id,road_feature_id,source_type,distance_m,confidence,candidate_count,assignment_status,assigned_by,assigned_at,updated_at) VALUES(:b,:r,:s,:d,:c,:cc,:st,:u,NOW(),NOW()) ON CONFLICT(building_feature_id) DO UPDATE SET road_feature_id=EXCLUDED.road_feature_id,source_type=EXCLUDED.source_type,distance_m=EXCLUDED.distance_m,confidence=EXCLUDED.confidence,candidate_count=EXCLUDED.candidate_count,assignment_status=EXCLUDED.assignment_status,assigned_by=EXCLUDED.assigned_by,assigned_at=NOW(),updated_at=NOW()"""),{"b":a.building_id,"r":a.road_id,"s":a.source_type,"d":a.distance_m,"c":a.confidence,"cc":a.candidate_count,"st":a.assignment_status,"u":user.id}); n+=1
    await log_audit(db,user.id,"HOUSE_NUMBER_ASSIGNMENTS_COMMIT","HouseNumbering",details={"count":n}); return {"success":True,"committed":n}

@router.post("/numbering/preview")
async def numbering_preview(x:NumberPreview,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
    await layer(db,x.building_layer_id,"Building"); await layer(db,x.road_layer_id,"Road")
    pol=dict(POLICY); pol.update(x.policy_overrides or {})
    q=text("""SELECT a.building_feature_id,a.road_feature_id,ST_AsBinary(b.geom) bg,ST_AsBinary(r.geom) rg,r.properties rp FROM building_road_assignments a JOIN vector_features b ON b.id=a.building_feature_id JOIN vector_features r ON r.id=a.road_feature_id WHERE b.layer_id=:b AND r.layer_id=:r AND a.assignment_status<>'UNASSIGNED' """+("AND ST_Intersects(b.geom,(SELECT geom FROM vector_features WHERE id=:w))" if x.ward_feature_id else "")+""" ORDER BY r.id,b.id LIMIT :lim""")
    p={"b":x.building_layer_id,"r":x.road_layer_id,"w":x.ward_feature_id,"lim":x.limit}
    tr=Transformer.from_crs(4326,METRIC_SRID,always_xy=True); back=Transformer.from_crs(METRIC_SRID,4326,always_xy=True)
    out=[]; seen={}
    for r in (await db.execute(q,p)).mappings().all():
        try:b=from_wkb(r["bg"]); road=from_wkb(r["rg"])
        except:continue
        if road.geom_type=="MultiLineString":road=linemerge(road)
        if road.geom_type!="LineString":continue
        road=shape({"type":"LineString","coordinates":list(road.coords)[::-1]}) if tuple(road.coords)[0]>tuple(road.coords)[-1] else road
        bm=transform(tr.transform,b); rm=transform(tr.transform,road); c=bm.centroid; ch=rm.project(c); seq=round(ch/float(pol["spacing_m"])); o=int(pol["numbering_origin"]); odd=o if o%2 else o+1; even=odd+1
        e=min(1,max(.1,rm.length/1000)); p0=rm.interpolate(max(0,ch-e)); p1=rm.interpolate(min(rm.length,ch+e)); side="left" if (p1.x-p0.x)*(c.y-p0.y)-(p1.y-p0.y)*(c.x-p0.x)>=0 else "right"; num=(odd if side=="left" else even)+2*seq
        name=next((str((r["rp"] or {}).get(k)) for k in ("resolved_roads","finalized_road_name","RECOMMEND","NEPALI_NAM","KVMP_NAM","name") if (r["rp"] or {}).get(k)), "Road")
        key=(r["road_feature_id"],num); seen[key]=seen.get(key,0)+1; disp=str(num)+("-"+chr(64+seen[key]) if seen[key]>1 else "")
        pt=rm.interpolate(max(0,min(rm.length,ch))); lon,lat=back.transform(pt.x,pt.y)
        out.append({"building_id":r["building_feature_id"],"road_id":r["road_feature_id"],"road_name":name,"chainage_m":round(ch,2),"side":side,"house_number":num,"display_number":name+"/"+disp,"point":{"type":"Point","coordinates":[lon,lat]}})
    rr=int((await db.execute(text("INSERT INTO numbering_runs(building_layer_id,road_layer_id,ward_feature_id,policy_version,status,parameters,created_by) VALUES(:b,:r,:w,1,'PREVIEW',:p,:u) RETURNING id"),{"b":x.building_layer_id,"r":x.road_layer_id,"w":x.ward_feature_id,"p":json.dumps(pol),"u":user.id})).scalar_one())
    for i in out: await db.execute(text("INSERT INTO numbering_run_items(run_id,building_feature_id,road_feature_id,house_number,display_number,chainage_m,side) VALUES(:run,:b,:r,:n,:d,:c,:s)"),{"run":rr,"b":i["building_id"],"r":i["road_id"],"n":i["house_number"],"d":i["display_number"],"c":i["chainage_m"],"s":i["side"]})
    return {"run_id":rr,"policy":pol,"items":out,"count":len(out)}

@router.post("/numbering/commit")
async def numbering_commit(x:NumberCommit,db:AsyncSession=Depends(get_db),user:User=Depends(require_role(UserRole.GisAdmin,UserRole.Validator))):
    rows=(await db.execute(text("SELECT * FROM numbering_run_items WHERE run_id=:r"),{"r":x.run_id})).mappings().all()
    for i in rows: await db.execute(text("""INSERT INTO house_numbers(building_feature_id,road_feature_id,numbering_run_id,house_number,display_number,road_name,chainage_m,side,status,is_manual,created_by) SELECT :b,:r,:run,:n,:d,COALESCE(r.properties->>'resolved_roads',r.properties->>'finalized_road_name',r.properties->>'RECOMMEND',r.properties->>'NEPALI_NAM',r.properties->>'KVMP_NAM',r.properties->>'name'),:c,:s,'COMMITTED',FALSE,:u FROM vector_features r WHERE r.id=:r ON CONFLICT(building_feature_id) DO UPDATE SET road_feature_id=EXCLUDED.road_feature_id,numbering_run_id=EXCLUDED.numbering_run_id,house_number=EXCLUDED.house_number,display_number=EXCLUDED.display_number,road_name=EXCLUDED.road_name,chainage_m=EXCLUDED.chainage_m,side=EXCLUDED.side,status='COMMITTED',updated_at=NOW()"""),{"b":i["building_feature_id"],"r":i["road_feature_id"],"run":x.run_id,"n":i["house_number"],"d":i["display_number"],"c":i["chainage_m"],"s":i["side"],"u":user.id})
    await db.execute(text("UPDATE numbering_runs SET status='COMMITTED',committed_by=:u,committed_at=NOW() WHERE id=:r"),{"u":user.id,"r":x.run_id}); await log_audit(db,user.id,"HOUSE_NUMBERING_COMMIT","NumberingRun",x.run_id,details={"count":len(rows)}); return {"success":True,"run_id":x.run_id,"committed":len(rows)}

@router.get("/numbering/runs")
async def runs(limit:int=50,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
    return [dict(r) for r in (await db.execute(text("SELECT r.*,u.username created_by_username FROM numbering_runs r LEFT JOIN users u ON u.id=r.created_by ORDER BY r.id DESC LIMIT :l"),{"l":limit})).mappings().all()]

@router.get("/search")
async def search(q:str,limit:int=50,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
    p={"q":"%"+q.strip()+"%","l":limit}; return [dict(r) for r in (await db.execute(text("SELECT * FROM house_numbers WHERE CAST(house_number AS TEXT) ILIKE :q OR display_number ILIKE :q OR COALESCE(road_name,'') ILIKE :q ORDER BY road_name,house_number LIMIT :l"),p)).mappings().all()]

@router.get("/audit")
async def audit(limit:int=100,db:AsyncSession=Depends(get_db),user:User=Depends(get_current_user)):
    return [{"id":x.id,"action":x.action,"entity_type":x.entity_type,"entity_id":x.entity_id,"details":x.details,"timestamp":x.timestamp} for x in (await db.execute(select(AuditLog).order_by(AuditLog.timestamp.desc()).limit(limit))).scalars().all()]
