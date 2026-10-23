import json,re,csv,collections
def towns(path):
    t=json.load(open(path)); (sx,sy),(tx,ty)=t["transform"]["scale"],t["transform"]["translate"]
    arcs=[]
    for a in t["arcs"]:
        x=y=0; pts=[]
        for dx,dy in a: x+=dx; y+=dy; pts.append((x*sx+tx,y*sy+ty))
        arcs.append(pts)
    def ring(r):
        out=[]
        for i in r: out+= arcs[i] if i>=0 else arcs[~i][::-1]
        return out
    res=[]
    for g in t["objects"]["towns"]["geometries"]:
        polys=[g["arcs"]] if g["type"]=="Polygon" else g["arcs"]
        res.append((g["properties"],[[ring(r) for r in p] for p in polys]))
    return res
def inside(pt,ring):
    x,y=pt; c=False
    for (x1,y1),(x2,y2) in zip(ring,ring[1:]+ring[:1]):
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1: c=not c
    return c
def locate(pt,ts):
    for p,polys in ts:
        for poly in polys:
            if inside(pt,poly[0]) and not any(inside(pt,h) for h in poly[1:]): return p["COUNTYNAME"]+p["TOWNNAME"]
