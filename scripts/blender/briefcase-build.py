"""Build Restore's articulated retro archive case using Blender alone.
Run: Blender --background --python scripts/blender/briefcase-build.py -- [--skip-renders] [--final]
Atlas quadrants (image top-down): painted metal | warm hardware / leather | cloth.
Three.js coordinates are authored explicitly; Blender converts (x,y,z) to (x,-z,y).
"""
import bpy, math, os, sys, json, time, argparse
import numpy as np
from mathutils import Vector
from collections import defaultdict
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
ART=os.path.join(ROOT,'art/briefcase'); OUT=os.path.join(ROOT,'public/models/briefcase')
for p in [ART,OUT,ART+'/textures',ART+'/renders']: os.makedirs(p,exist_ok=True)
p=argparse.ArgumentParser(); p.add_argument('--skip-renders',action='store_true'); p.add_argument('--final',action='store_true'); args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for d in list(bpy.data.materials): bpy.data.materials.remove(d)
COL=bpy.data.collections.new('Briefcase editable components'); bpy.context.scene.collection.children.link(COL)

def coord(v): return (v[0],-v[2],v[1])
def image_write(name,arr,path,colorspace='Non-Color'):
    h,w=arr.shape[:2]; im=bpy.data.images.new(name,width=w,height=h,alpha=True)
    im.colorspace_settings.name=colorspace; im.pixels.foreach_set(arr.astype(np.float32).ravel()); im.filepath_raw=path; im.file_format='PNG'; im.save(); return im
N=2048; rng=np.random.default_rng(4172)
y,x=np.mgrid[0:N,0:N]; base=np.ones((N,N,4),np.float32); orm=np.ones_like(base); heights=np.zeros((N,N),np.float32)
# np row zero is Blender UV bottom, so the first two entries are the lower atlas row.
colors=[(.235,.100,.072),(.155,.173,.155),(.315,.340,.292),(.56,.465,.32)]
rough=[.63,.93,.61,.34]; metals=[0,0,.65,.95]
for q in range(4):
    row=q//2; col=q%2; sl=(slice(row*N//2,(row+1)*N//2),slice(col*N//2,(col+1)*N//2)); xx=x[sl]; yy=y[sl]
    fine=rng.normal(0,1,xx.shape).astype(np.float32)
    grain=(np.sin(xx*.021+np.cos(yy*.034))*np.cos(yy*.014)+np.sin(xx*.071+yy*.026))*.013
    if q==0: # tightly grained leather, subtle pores
        tex=grain+fine*.010+np.sin(xx*.82)*np.sin(yy*.93)*.006; h=fine*.10+np.sin(xx*.82)*np.sin(yy*.93)*.08
    elif q==1:
        tex=grain*.28+np.sin(xx*math.pi/3)*.020+np.sin(yy*math.pi/3)*.023+fine*.004; h=np.sin(xx*math.pi/3)*.13+np.sin(yy*math.pi/3)*.13
    elif q==2:
        tex=grain*.7+fine*.004+np.sin(yy*1.81)*.003; h=fine*.04+np.sin(yy*1.81)*.06
    else:
        tex=grain*.6+fine*.004+np.sin(xx*2.4)*.015; h=np.sin(xx*2.4)*.15+fine*.02
    base[sl+(slice(0,3),)]=np.clip(np.array(colors[q])[None,None,:]+tex[:,:,None],.02,.98)
    orm[sl+(0,)]=1; orm[sl+(1,)]=np.clip(rough[q]+grain*.8+fine*.003,.05,.98); orm[sl+(2,)]=metals[q]
    heights[sl]=h
normal=np.ones_like(base); gy,gx=np.gradient(heights); normal[:,:,0]=.5-gx*.34; normal[:,:,1]=.5-gy*.34; normal[:,:,2]=1
basepath=ART+'/textures/briefcase-basecolor-placeholder.png'; finalpath=ART+'/textures/briefcase-basecolor-final.png'
if not os.path.exists(basepath): image_write('PlaceholderBaseColor',base,basepath,'sRGB')
if not os.path.exists(ART+'/textures/briefcase-orm.png'): image_write('BriefcaseORM',orm,ART+'/textures/briefcase-orm.png')
if not os.path.exists(ART+'/textures/briefcase-normal.png'): image_write('BriefcaseNormal',normal,ART+'/textures/briefcase-normal.png')
print('ATLAS_READY '+basepath,flush=True)
if args.final and not os.path.exists(finalpath):raise FileNotFoundError('Final basecolor atlas is missing: '+finalpath)
baseim=bpy.data.images.load(finalpath if args.final and os.path.exists(finalpath) else basepath,check_existing=True); baseim.colorspace_settings.name='sRGB'
ormim=bpy.data.images.load(ART+'/textures/briefcase-orm.png',check_existing=True); ormim.colorspace_settings.name='Non-Color'
normim=bpy.data.images.load(ART+'/textures/briefcase-normal.png',check_existing=True); normim.colorspace_settings.name='Non-Color'
# Auxiliary maps use 1k resolution on the web; editable source atlas remains 2k.
for img in [ormim,normim]:
    img.scale(1024,1024); img.filepath_raw=OUT+'/'+os.path.basename(img.filepath); img.save()
mat_names=['Oxblood grained leather','Woven olive charcoal lining','Aged olive enamel','Brushed champagne nickel']
mats=[]
for q,name in enumerate(mat_names):
    m=bpy.data.materials.new(name); m.use_nodes=True; nodes=m.node_tree.nodes; bs=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexImage'); tex.image=baseim; m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    ormtex=nodes.new('ShaderNodeTexImage'); ormtex.image=ormim; sep=nodes.new('ShaderNodeSeparateColor'); m.node_tree.links.new(ormtex.outputs['Color'],sep.inputs[0]); m.node_tree.links.new(sep.outputs['Green'],bs.inputs['Roughness']); m.node_tree.links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
    nt=nodes.new('ShaderNodeTexImage'); nt.image=normim; nm=nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=.34; m.node_tree.links.new(nt.outputs['Color'],nm.inputs['Color']); m.node_tree.links.new(nm.outputs[0],bs.inputs['Normal'])
    m.diffuse_color=(*colors[q],1); mats.append(m)

root=bpy.data.objects.new('Briefcase',None); COL.objects.link(root)
def empty(name,pos=(0,0,0),parent=root):
    ob=bpy.data.objects.new(name,None); COL.objects.link(ob); ob.location=coord(pos); ob.parent=parent; return ob
lid=empty('LidPivot',(0,.12,-.315)); handle=empty('HandlePivot',(0,-.045,.349)); latchL=empty('LatchPivot_L',(-.365,.105,.337)); latchR=empty('LatchPivot_R',(.365,.105,.337))
parts=[]
def assign(ob,name,mat,parent,group):
    ob.name=name
    for c in list(ob.users_collection): c.objects.unlink(ob)
    COL.objects.link(ob); ob.parent=parent; ob.data.materials.append(mats[mat]); ob['part_group']=group; ob['atlas_quadrant']=mat
    parts.append(ob); return ob

def uv(ob,q):
    if not ob.data.uv_layers: ob.data.uv_layers.new(name='UVMap')
    layer=ob.data.uv_layers.active.data; vs=ob.data.vertices
    # One physical texel density on both planar axes. Tiny bevels/hardware sample tiny
    # patches; narrow walls never stretch an entire atlas quadrant across their height.
    center=[(min(v.co[i]for v in vs)+max(v.co[i]for v in vs))*.5 for i in range(3)]
    metres_to_uv=.448
    for f in ob.data.polygons:
        axis=max(range(3),key=lambda i:abs(f.normal[i])); a,b=[i for i in range(3) if i!=axis]
        for li in f.loop_indices:
            v=vs[ob.data.loops[li].vertex_index].co
            u=.25+metres_to_uv*(v[a]-center[a]); w=.25+metres_to_uv*(v[b]-center[b])
            # Case surfaces are under a metre. Guard small numerical excursions only.
            assert .02 <= u <= .48 and .02 <= w <= .48, (ob.name,u,w)
            layer[li].uv=(u+(q%2)*.5,w+(q//2)*.5)

def finish(ob,bevel=0):
    bpy.context.view_layer.objects.active=ob; ob.select_set(True)
    if bevel:
        mod=ob.modifiers.new('Hand eased manufacturing edges','BEVEL'); mod.width=bevel; mod.segments=1 if bevel<=.0009 else 2 if bevel<.003 else 3; mod.affect='EDGES'
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # Weighted corner normals keep broad sheet metal planes flat.
    for poly in ob.data.polygons: poly.use_smooth=True
    mod=ob.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL'); mod.keep_sharp=True; mod.weight=40
    try: bpy.ops.object.modifier_apply(modifier=mod.name)
    except: pass
    ob.data.update(); uv(ob,int(ob['atlas_quadrant'])); ob.select_set(False); return ob

def box(name,size,pos,mat=3,parent=root,bevel=.004,group='base'):
    bpy.ops.mesh.primitive_cube_add(size=1,location=coord(pos)); ob=bpy.context.object; ob.dimensions=(size[0],size[2],size[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); assign(ob,name,mat,parent,group); finish(ob,bevel); return ob

def cyl(name,r,depth,pos,mat=3,parent=root,axis='Y',verts=20,group='hardware'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=depth,location=coord(pos)); ob=bpy.context.object
    if axis=='X': ob.rotation_euler[1]=math.pi/2
    elif axis=='Z': ob.rotation_euler[0]=math.pi/2
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True); assign(ob,name,mat,parent,group); finish(ob,.0009);return ob

def round_points(w,d,r,steps=8,zcenter=0):
    res=[]
    for cx,cz,start in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
        for i in range(steps):
            t=math.radians(start+i*90/steps); res.append((cx+r*math.cos(t),cz+r*math.sin(t)+zcenter))
    return res

def mesh_obj(name,verts,faces,mat,parent,group,bevel=0):
    me=bpy.data.meshes.new(name); me.from_pydata([coord(v) for v in verts],[],faces); me.update();ob=bpy.data.objects.new(name,me);COL.objects.link(ob); ob.parent=parent; ob.data.materials.append(mats[mat]);ob['part_group']=group;ob['atlas_quadrant']=mat;parts.append(ob)
    bpy.context.view_layer.objects.active=ob; ob.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');finish(ob,bevel);return ob

def shell(name,w,d,r,bottom,top,innerfloor,thick,mat,parent,zc=0,group='base',invert=False):
    outer=round_points(w,d,r,zcenter=zc);inner=round_points(w-2*thick,d-2*thick,max(.004,r-thick),zcenter=zc); n=len(outer)
    rings=[[(x,bottom,z)for x,z in outer],[(x,top,z)for x,z in outer],[(x,top,z)for x,z in inner],[(x,innerfloor,z)for x,z in inner]]
    v=sum(rings,[]); f=[]
    for k in range(3):
        for i in range(n):j=(i+1)%n;f.append((k*n+i,k*n+j,(k+1)*n+j,(k+1)*n+i))
    f.append(tuple(range(n-1,-1,-1)));f.append(tuple(range(3*n,4*n)))
    return mesh_obj(name,v,f,mat,parent,group,.0018)

def ring(name,w,d,r,y,h,t,mat,parent=root,zc=0,group='trim'):
    out=round_points(w,d,r,zcenter=zc); inn=round_points(w-2*t,d-2*t,max(.003,r-t),zcenter=zc);n=len(out)
    rings=[[(x,y-h/2,z)for x,z in out],[(x,y+h/2,z)for x,z in out],[(x,y+h/2,z)for x,z in inn],[(x,y-h/2,z)for x,z in inn]];v=sum(rings,[]);f=[]
    for k in range(4):
        for i in range(n): j=(i+1)%n;f.append((k*n+i,k*n+j,((k+1)%4)*n+j,((k+1)%4)*n+i))
    return mesh_obj(name,v,f,mat,parent,group,.0007)

body=shell('BodyStatic',.96,.63,.057,-.10,.10,-.077,.018,2,root)
# A shallow deep drawn lid is open below, not a solid slab.
lidshell=shell('LidStatic',.96,.63,.057,.075,-.011,.058,.017,2,lid,zc=.315,group='lid')
ring('Continuous rolled lower rim',.973,.643,.061,-.084,.019,.021,3)
ring('Folded base opening rim',.977,.647,.061,.095,.018,.017,3)
ring('Lid closing rolled rim',.976,.646,.06,-.007,.014,.017,3,lid,zc=.315,group='lid')
ring('Top cap rolled seam',.971,.641,.058,.070,.017,.017,3,lid,zc=.315,group='lid')
ring('Inset lid pressed outline',.868,.538,.055,.077,.003,.007,3,lid,zc=.315,group='lid')
# Fitted fabric lining has its own shell, leaving generous document volume.
shell('Body fitted fabric lining',.920,.590,.036,-.074,.072,-.064,.006,1,root)
box('Lid padded canvas liner',(.891,.016,.556),(0,.050,.315),1,lid,.020,'lid')
ring('Liner welt binding',.902,.566,.045,.039,.009,.009,0,lid,zc=.315,group='lid')
# Organizer is built as a shallow leather pocket with a visible mouth and pleated end gussets.
box('Organizer pocket leather face',(.66,.013,.19),(0,.023,.377),0,lid,.012,'lid')
box('Organizer pocket lower stitched welt',(.664,.018,.014),(0,.016,.465),0,lid,.004,'lid')
for sx in [-1,1]:
    box('Organizer gusset',(.019,.031,.18),(sx*.326,.029,.375),0,lid,.003,'lid')
    for j in range(14): box('Hand sewn pocket stitch',(.0016,.0018,.004),(sx*.307,.014,.295+j*.011),3,lid,.0005,'lid')
for j in range(47):box('Pocket lower stitch',(.004,.0015,.0017),(-.300+j*.013,.014,.455),3,lid,.0004,'lid')
# Stamped corners: curving wrap plates, fitted across each seam with real separated thickness.
for sx in [-1,1]:
  for sz in [-1,1]:
    for parent,yy,zc,grp in [(root,.004,0,'base'),(lid,.033,.315,'lid')]:
        yy0,hh=(yy,.153) if parent==root else (yy,.058)
        xx=sx*.426;zz=zc+sz*.26
        # outer and inner quarter cylinders; make solid bent panel.
        ang0=0 if sx>0 and sz>0 else 90 if sx<0 and sz>0 else 180 if sx<0 and sz<0 else 270
        pts=[]
        for rad,yv in[(.058,yy0-hh/2),(.058,yy0+hh/2),(.053,yy0+hh/2),(.053,yy0-hh/2)]:
            pts += [(xx+rad*math.cos(math.radians(ang0+i*90/8)),yv,zz+rad*math.sin(math.radians(ang0+i*90/8)))for i in range(9)]
        ff=[]
        for k in range(4):
            for i in range(8):ff.append((k*9+i,k*9+i+1,((k+1)%4)*9+i+1,((k+1)%4)*9+i))
        ff += [(0,9,18,27),(8,35,26,17)]
        mesh_obj('Formed corner guard',pts,ff,3,parent,grp,.001)
# Foot pads keep the shell clear of the tabletop.
for xx in [-.35,.35]:
  for zz in [-.22,.22]:box('Leather tabletop foot',(.073,.010,.052),(xx,-.098,zz),0,root,.008,'base')
# Slotted screws are tiny engraved-looking recesses, with separate head geometry.
def screw(name,pos,parent=root,axis='Z',group='hardware',r=.006):
    cyl(name+' head',r,.0025,pos,3,parent,axis,16,group)
    size=(r*1.30,.0013,.001) if axis=='Z' else (r*1.30,.001,.0013)
    pp=list(pos);pp[2]+=.0015 if axis=='Z' else 0;pp[1]+=.0015 if axis=='Y' else 0
    box(name+' slot',size,pp,0,parent,.0003,group)
for x0 in [-.413,-.34,-.26,.26,.34,.413]:
    screw('Front perimeter screw',(x0,.082,.325))
    screw('Lid front screw',(x0,.033,.641),lid,group='lid')
for x0 in [-.43,.43]:
    for z0 in [-.22,.22]:screw('Corner crown screw',(x0,.081,z0+.315),lid,axis='Y',group='lid')
# Rear hinges: interleaved hinge barrels, separate moving lid leaves, visible steel pins.
for xx in [-.303,.303]:
    box('Fixed hinge leaf',(.154,.085,.006),(xx,.0715,-.321),3,root,.004,'hinge')
    box('Moving hinge leaf',(.154,.040,.006),(xx,.032,-.0055),3,lid,.004,'lid')
    for j in range(7):
        xh=xx+(j-3)*.0188
        cyl('Hinge interleaved knuckle',.014,.0175,(xh,.120,-.315) if j%2==0 else (xh,0,0),3,root if j%2==0 else lid,'X',16,'hinge' if j%2==0 else 'lid')
    cyl('Full length hinge pin',.0042,.155,(xx,.120,-.315),3,root,'X',16,'hinge')
    for dx in [-.052,.052]:
        screw('Hinge fixed screw',(xx+dx,.047,-.325),root,group='hinge')
        screw('Hinge lid screw',(xx+dx,.026,-.015),lid,group='lid')
# Handle rotates on two pivot brackets. Flat leather-wrapped arch with stitched rolled edges.
for xx in [-.168,.168]:
    box('Handle attachment plate',(.044,.075,.009),(xx,-.027,.326),3,root,.009,'handle-bracket')
    cyl('Handle swiveling rivet',.012,.041,(xx,-.045,.350),3,root,'X',20,'handle-bracket')
    screw('Handle plate fastener',(xx,.001,.334))
# Arch is a thick, closed band in horizontal XZ, gracefully bowed away from the front panel.
def handle_band(name,width,depth,mat):
    vv=[];samples=24
    for yv,rr in [(-depth/2,0),(depth/2,0),(depth/2,width),(-depth/2,width)]:
        for i in range(samples+1):
            t=math.pi*i/samples;xx=(.166-rr)*math.cos(t);zz=(.107-rr)*math.sin(t)
            vv.append((xx,yv,zz))
    nn=samples+1;ff=[]
    for k in range(4):
        for i in range(samples):ff.append((k*nn+i,k*nn+i+1,((k+1)%4)*nn+i+1,((k+1)%4)*nn+i))
    ff += [(0,nn,2*nn,3*nn),(nn-1,4*nn-1,3*nn-1,2*nn-1)]
    return mesh_obj(name,vv,ff,mat,handle,'handle',.002)
handle_band('Leather handle shaped grip',.030,.034,0)
for i in range(33):
    t=.17+(math.pi-.34)*i/32
    for sy in [-1,1]:
        ob=box('Handle saddle stitch',(.0032,.0011,.0018),(.153*math.cos(t),sy*.0175,.096*math.sin(t)),3,handle,.0003,'handle')
# Twin spring clasps: backing plates + pivot pins + articulated retaining tongues.
for xx,piv in [(-.365,latchL),(.365,latchR)]:
    box('Clasp stamped backing plate',(.091,.129,.012),(xx,.012,.327),3,root,.012,'clasp')
    box('Clasp receiver loop',(.067,.021,.034),(xx,-.017,.346),3,root,.005,'clasp')
    for dx in [-.029,.029]:screw('Clasp plate screw',(xx+dx,.055,.335))
    cyl('Clasp tongue hinge pin',.008,.084,(xx,.105,.337),3,root,'X',16,'clasp')
    cyl('Clasp tongue rolled knuckle',.010,.057,(0,0,0),3,piv,'X',16,'moving-clasp')
    box('Articulated clasp tongue',(.053,.105,.009),(0,-.049,.012),3,piv,.007,'moving-clasp')
    box('Clasp lever thumb lip',(.057,.015,.021),(0,-.098,.026),3,piv,.005,'moving-clasp')
    box('Clasp engraved inset',(.029,.043,.001),(0,-.055,.0173),3,piv,.004,'moving-clasp')
# The default GLB is self-contained: Blender renders a tiny emission-only numeral texture.
# Runtime swaps the same full-UV surfaces for live combination digits.
def numeral_material():
    path=OUT+'/briefcase-digit-0.png'
    if not os.path.exists(path):
        prev=bpy.context.window.scene; temp=bpy.data.scenes.new('Numeral albedo bake');bpy.context.window.scene=temp
        temp.render.engine='CYCLES';temp.cycles.samples=1;temp.cycles.use_denoising=False
        temp.render.resolution_x=256;temp.render.resolution_y=256;temp.render.resolution_percentage=100
        temp.view_settings.view_transform='Standard';temp.render.image_settings.file_format='PNG';temp.render.image_settings.color_mode='RGB'
        temp.world=bpy.data.worlds.new('Numeral black world');temp.world.color=(0,0,0)
        def emat(name,color):
            m=bpy.data.materials.new(name);m.use_nodes=True;m.node_tree.nodes.clear();e=m.node_tree.nodes.new('ShaderNodeEmission');e.inputs[0].default_value=(*color,1);o=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(e.outputs[0],o.inputs[0]);return m
        bpy.ops.mesh.primitive_plane_add(size=2);plane=bpy.context.object;plane.data.materials.append(emat('Numeral dark enamel',(.014,.017,.013)))
        text=bpy.data.curves.new('Engraved zero','FONT');text.body='0';text.align_x='CENTER';text.align_y='CENTER';text.size=.82;text.resolution_u=8
        font=bpy.data.objects.new('Engraved zero',text);temp.collection.objects.link(font);font.location=(0,0,.01);text.materials.append(emat('Warm ivory enamel inlay',(.67,.66,.55)))
        cd=bpy.data.cameras.new('Numeral camera');cam=bpy.data.objects.new('Numeral camera',cd);temp.collection.objects.link(cam);cam.location=(0,0,1);cd.type='ORTHO';cd.ortho_scale=1;temp.camera=cam
        temp.render.filepath=path;bpy.ops.render.render(write_still=True)
        bpy.context.window.scene=prev
        for ob in list(temp.objects):bpy.data.objects.remove(ob,do_unlink=True)
        bpy.data.scenes.remove(temp)
    im=bpy.data.images.load(path,check_existing=True);im.colorspace_settings.name='sRGB'
    m=bpy.data.materials.new('Inlaid lock numeral');m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.59;tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color']);return m
numbermat=numeral_material()
# Four independent knurled wheels, a common cast escutcheon and dark numeral windows.
box('Combination lock common escutcheon',(.557,.112,.040),(0,.01,.332),3,root,.017,'lock')
for sign in [-1,1]: screw('Lock mounting screw',(sign*.259,.01,.355),root)
for i in range(4):
    xx=(i-1.5)*.132; wp=empty('Wheel_'+str(i),(xx,.01,.358));
    cyl('Number wheel '+str(i),.047,.063,(0,0,0),3,wp,'X',32,'wheel')
    for j in range(24):
        t=j*math.tau/24
        ob=box('Wheel knurled tooth',(.062,.004,.004),(0,.047*math.cos(t),.047*math.sin(t)),3,wp,.0008,'wheel');ob.rotation_euler[0]=t
    for dx in [-.043,.043]:box('Wheel retaining shoulder',(.015,.087,.035),(xx+dx,.01,.359),3,root,.004,'lock')
    # Display front is +Z in Three. Runtime replaces only this plane's material with its numeral canvas.
    ob=mesh_obj('NumberDisplay_'+str(i),[(-.029,-.030,0),(.029,-.030,0),(.029,.030,0),(-.029,.030,0)],[(0,1,2,3)],0,root,'display')
    ob.location=coord((xx,.01,.409));ob.data.materials.clear();ob.data.materials.append(numbermat);
    # conventional full UV, independent of the material atlas for runtime replacement.
    for loop,co in zip(ob.data.uv_layers.active.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=co
# Export notes and component grouping remain in the editable .blend as custom properties.
root['assetVersion']='1.0.4';root['asset']='Restore archival briefcase';root['units']='meters';root['three_coordinate_contract']='x right, y up, z front';root['lid_open_rotation_x']=-1.75
root['atlas_layout']='top-left painted metal; top-right champagne hardware; bottom-left oxblood leather; bottom-right woven lining'
bpy.context.view_layer.update()

# Group the final GLB by material and articulation. Editable source objects stay separately modeled in .blend.
# First save the honest source model with individual knuckles, screws, panels and fittings.
def export_asset():
    export_col=bpy.data.collections.new('GLB optimized render batches');bpy.context.scene.collection.children.link(export_col)
    exroot=bpy.data.objects.new('Briefcase_export',None);export_col.objects.link(exroot)
    for key in root.keys():exroot[key]=root[key]
    parentmap={root:exroot}
    empties=[o for o in COL.objects if o.type=='EMPTY' and o!=root]
    for ob in empties:
        cp=ob.copy();cp.name=ob.name+'_export';export_col.objects.link(cp);cp.parent=parentmap.get(ob.parent,exroot);parentmap[ob]=cp
    buckets=defaultdict(list)
    for ob in parts:
        if ob.name.startswith('NumberDisplay_'):
            key=(ob.parent,ob.name)
        else:key=(ob.parent,int(ob['atlas_quadrant']))
        buckets[key].append(ob)
    exports=[];names=[]
    for (par,key),objects in buckets.items():
        copied=[]
        for ob in objects:
            cp=ob.copy();cp.data=ob.data.copy();export_col.objects.link(cp);cp.parent=parentmap.get(par,exroot);copied.append(cp)
        bpy.ops.object.select_all(action='DESELECT')
        for cp in copied:cp.select_set(True)
        bpy.context.view_layer.objects.active=copied[0]
        if len(copied)>1:bpy.ops.object.join()
        cp=bpy.context.view_layer.objects.active
        if isinstance(key,str): name=key
        elif par==root:name='BodyStatic' if key==2 else 'BodyStatic_'+['Leather','Fabric','Paint','Hardware'][key]
        elif par==lid:name='LidStatic' if key==2 else 'LidStatic_'+['Leather','Fabric','Paint','Hardware'][key]
        else:name=par.name+'_Mesh_'+str(key)
        cp.name=name+'_export';exports.append(cp);names.append((cp,name))
    # Give exported objects their exact runtime names without renaming editable source permanently.
    originals=[]
    for cp,name in names+[(v,k.name) for k,v in parentmap.items()]:
        other=bpy.data.objects.get(name)
        if other and other!=cp:originals.append((other,name));other.name=name+'_editable'
        cp.name=name
    bpy.ops.object.select_all(action='DESELECT')
    for ob in export_col.objects:ob.select_set(True)
    bpy.context.view_layer.objects.active=exroot
    target=OUT+'/briefcase.glb'
    bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',use_selection=True,export_apply=False,export_yup=True,export_materials='EXPORT',export_image_format='AUTO',export_cameras=False,export_lights=False,export_extras=True)
    tris=sum(sum(len(p.vertices)-2 for p in ob.data.polygons)for ob in exports)
    report={'assetVersion':root['assetVersion'],'triangles':tris,'renderMeshes':len(exports),'nodes':[ob.name for ob in export_col.objects],'bodyBounds':[-.48,-.10,-.315,.48,.10,.315],'atlas':os.path.basename(baseim.filepath),'glbBytes':os.path.getsize(target)}
    with open(ART+'/asset-report.json','w') as f:json.dump(report,f,indent=2)
    for ob in list(export_col.objects):bpy.data.objects.remove(ob,do_unlink=True)
    bpy.data.collections.remove(export_col)
    for ob,name in originals:ob.name=name
    print('EXPORT_READY '+json.dumps(report),flush=True)
export_asset()

# Geometry QA: connected watertight manufacturing solids, finite coordinates, UV containment.
import bmesh
issues=[];totaltri=0
for ob in parts:
    totaltri+=sum(len(p.vertices)-2 for p in ob.data.polygons)
    if ob.name.startswith('NumberDisplay_'):continue # intentional one-sided decal surface
    bm=bmesh.new();bm.from_mesh(ob.data);bad=[e for e in bm.edges if not e.is_manifold]
    if bad:issues.append({'part':ob.name,'nonManifoldEdges':len(bad)})
    bm.free()
    q=int(ob['atlas_quadrant']);u0=(q%2)*.5;v0=(q//2)*.5
    if any(not (u0+.02-1e-6<=v.uv.x<=u0+.48+1e-6 and v0+.02-1e-6<=v.uv.y<=v0+.48+1e-6)for v in ob.data.uv_layers.active.data):issues.append({'part':ob.name,'uvOutsideMaterialTile':True})
# Test the actual outer shells through the hinge sweep, including triangle intersection.
from mathutils.bvhtree import BVHTree
def mesh_bvh(ob):
    return BVHTree.FromPolygons([ob.matrix_world @ v.co for v in ob.data.vertices],[list(f.vertices) for f in ob.data.polygons],all_triangles=False)
def bounds_three(ob):
    vv=[ob.matrix_world @ Vector(v) for v in ob.bound_box]
    pts=[(v.x,v.z,-v.y)for v in vv]
    return {'min':[min(v[i]for v in pts)for i in range(3)],'max':[max(v[i]for v in pts)for i in range(3)]}
closed_bounds={'baseShell':bounds_three(body),'lidShell':bounds_three(lidshell)}
base_bvh=mesh_bvh(body)
# The fixed hinge axis must remain invariant while the painted shells remain disjoint.
angles=[0,-.35,-.8,-1.3,-1.75];sweep=[]
for a in angles:
    lid.rotation_euler.x=a;bpy.context.view_layer.update();pvt=lid.matrix_world.translation
    sweep.append({'angle':a,'pivotBlender':list(pvt),'shellTriangleIntersections':len(base_bvh.overlap(mesh_bvh(lidshell))), 'finite':all(math.isfinite(v) for ob in parts if ob.parent==lid for vv in ob.bound_box for v in ob.matrix_world@Vector(vv))})
lid.rotation_euler.x=0
with open(ART+'/geometry-qa.json','w')as f:json.dump({'manufacturedParts':len(parts),'triangles':totaltri,'issues':issues,'closedBoundsThree':closed_bounds,'hingeSweep':sweep,'note':'Open decal planes intentionally excluded from manifold requirement. Both shells are closed solids surrounding a genuinely hollow interior.'},f,indent=2)
if any(s['shellTriangleIntersections'] for s in sweep):issues.append({'hingeSweepIntersections':sweep})
if issues:raise RuntimeError('Geometry QA failed: '+str(issues[:5]))

# Neutral studio isolated from the export hierarchy.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100
scene.world.color=(.12,.12,.12);scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=False
studio=bpy.data.collections.new('Studio render only');scene.collection.children.link(studio)
def studio_obj(ob):
    for c in list(ob.users_collection):c.objects.unlink(ob)
    studio.objects.link(ob)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.111));ground=bpy.context.object;ground.name='Studio ground';studio_obj(ground)
gm=bpy.data.materials.new('Studio warm grey');gm.diffuse_color=(.19,.205,.21,1);gm.use_nodes=True;gm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.19,.205,.21,1);gm.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.91;ground.data.materials.append(gm)
for name,pos,energy,size,color in [('large softbox',(-1.5,-2.0,2.8),180,2.3,(1,.88,.72)),('cool fill',(2,.5,1.5),135,2.0,(.72,.84,1)),('rim strip',(-.5,2,2.2),220,1.6,(1,.96,.88)),('underside inspection fill',(0,0,-1.5),65,2,(.86,.90,1))]:
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;data.color=color;ob=bpy.data.objects.new(name,data);studio.objects.link(ob);ob.location=pos;ob.rotation_euler=(Vector((0,0,.1))-ob.location).to_track_quat('-Z','Y').to_euler()
camdata=bpy.data.cameras.new('Studio camera');camera=bpy.data.objects.new('Studio camera',camdata);studio.objects.link(camera);scene.camera=camera;camdata.type='ORTHO';camdata.lens=55

def camera_view(pos,target=(0,0,.04),scale=1.43):
    camera.location=pos;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camdata.ortho_scale=scale

def render(path,pos,target=(0,0,.04),scale=1.43,res=640):
    camera_view(pos,target,scale);scene.render.resolution_x=res;scene.render.resolution_y=res;scene.render.filepath=path;bpy.ops.render.render(write_still=True)

def sheet(name,angles,scale=1.43,target=(0,0,.04),res=640):
    result=np.ones((res*2,res*2,4),np.float32)
    for i,pos in enumerate(angles):
        path=ART+'/renders/'+name+'-'+str(i+1)+'.png';render(path,pos,target,scale,res)
        im=bpy.data.images.load(path,check_existing=False);arr=np.array(im.pixels[:],dtype=np.float32).reshape((res,res,4));row=1-i//2;col=i%2;result[row*res:(row+1)*res,col*res:(col+1)*res]=arr;bpy.data.images.remove(im)
    image_write(name+' four angles',result,ART+'/renders/'+name+'-four-angles.png','sRGB')
    print('SHEET_READY '+name,flush=True)
# Save source with setup, closed case and cameras. All source pieces remain individually editable.
camera_view((1.2,-1.5,1.15));
for im in [baseim,ormim,normim]+[n.image for n in numbermat.node_tree.nodes if n.type=='TEX_IMAGE']:im.pack()
bpy.ops.wm.save_as_mainfile(filepath=ART+'/restore-retro-briefcase.blend')
if not args.skip_renders:
    sheet('briefcase',[(1.2,-1.5,1.15),(-1.2,-1.5,.85),(-1.2,1.5,1.1),(1.2,1.5,.65)])
    lid.rotation_euler.x=-1.75;latchL.rotation_euler.x=-1.05;latchR.rotation_euler.x=-1.05
    render(ART+'/renders/briefcase-open.png',(1.3,-1.8,1.7),(0,.01,.26),1.6,1024)
    lid.rotation_euler.x=0;latchL.rotation_euler.x=0;latchR.rotation_euler.x=0
    # Exploded assembly illustration uses actual separated source pieces, with exaggerated spacing.
    saved={ob:ob.location.copy() for ob in parts}; empty_saved={ob:ob.location.copy()for ob in [lid,handle,latchL,latchR]}
    lid.location.z+=.44;handle.location.y-=.28;latchL.location.y-=.16;latchR.location.y-=.16
    for ob in parts:
        grp=ob['part_group']
        if ob.parent==root:
            if grp=='hinge':ob.location.y+=.16
            elif grp=='lock':ob.location.y-=.15
            elif grp=='handle-bracket':ob.location.y-=.11
            elif grp=='clasp':ob.location.y-=.09
            elif int(ob['atlas_quadrant'])==1:ob.location.z+=.12
    for ob in COL.objects:
        if ob.name.startswith('Wheel_') and ob.type=='EMPTY':ob.location.y-=.23
    render(ART+'/renders/briefcase-exploded.png',(1.45,-2.2,1.7),(0,-.10,.32),1.95,1024)
    for ob,pos in saved.items():ob.location=pos
    for ob,pos in empty_saved.items():ob.location=pos
    for i in range(4):bpy.data.objects['Wheel_'+str(i)].location=coord(((i-1.5)*.132,.01,.358))
    # Every distinct assembly receives four true Blender camera renders. Identical screws are grouped.
    groups={
      'base-shell':lambda o:o.parent==root and o['part_group'] in ['base','trim'],
      'lid-liner':lambda o:o.parent==lid,
      'hinge':lambda o:o['part_group']=='hinge' and o.matrix_world.translation.x<0 or o.parent==lid and 'hinge' in o.name.lower() and o.matrix_world.translation.x<0,
      'clasp':lambda o:o.parent==latchR or o['part_group']=='clasp' and o.matrix_world.translation.x>0,
      'handle':lambda o:o.parent==handle or o['part_group']=='handle-bracket',
      'combination-lock':lambda o:o['part_group']in ['lock','wheel','display']}
    for name,predicate in groups.items():
        keep=[ob for ob in parts if predicate(ob)]
        for ob in parts:ob.hide_render=ob not in keep
        scene.view_layers.update() if hasattr(scene.view_layers,'update') else None
        bpy.context.view_layer.update();bounds=[ob.matrix_world@Vector(v)for ob in keep for v in ob.bound_box]
        lo=Vector([min(v[i]for v in bounds)for i in range(3)]);hi=Vector([max(v[i]for v in bounds)for i in range(3)]);center=(lo+hi)/2;size=max(hi-lo);scale=max(size*1.5,.2)
        ground.hide_render=True
        offsets=[(1,-1,1),(-1,-1,.7),(-1,1,1),(1,1,-.6)]
        sheet(name,[center+Vector(v)*size*2 for v in offsets],scale,center,512)
    for ob in parts:ob.hide_render=False
    ground.hide_render=False
    print('ALL_RENDERS_READY',flush=True)
